import { PrismaDb } from "../../core/database/prisma.types";

import DashboardOverviewRepository from "./repository/dashboard-overview.repository";
import DashboardFloatRepository from "./repository/dashboard-float.repository";
import DashboardServiceRepository from "./repository/dashboard-service.repository";

import { DashboardAnalyticsFilter, DashboardFilter } from "./dashboard.types";

import {
  calculateOverview,
  mapFloatSummary,
  mapHourlyDistribution,
  mapMachineSummary,
  mapRecentTransactions,
  mapServiceSummary,
  mapServicesByCategory,
  mapServiceTrend,
  mapStatusSummary,
  mapSuccessFailureTrend,
  mapTransactionTrend,
} from "./dashboard.mapper";
import { BadRequestError } from "../../core/errors/BadRequestError";
import DashboardMachineRepository from "./repository/dashboard-machine.repository";
import { getMachineStatus } from "./dashboard.helper";
import DashboardAnalyticsRepository from "./repository/dashboard-analytics.repository";
import { DashboardAnalyticsQuery } from "./dashboard.validation";
import DashboardActivationRepository from "./repository/dashboard-activation.repository";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";
import { getDashboardDateRange } from "../../core/utils/dashboard-date-range";
import DashboardCspSummaryRepository from "./repository/dashboard-csp-summary.repository";
import SubscriptionEntitlementService from "../subscriptions/subscription-entitlement.service";

/**
 * Nulls the per-machine float figures in machine monitoring.
 */
function hideMonitoringFloat<T>(summary: T): T {
  if (
    !summary ||
    typeof summary !== "object" ||
    !("monitoring" in summary) ||
    !Array.isArray(summary.monitoring)
  ) {
    return summary;
  }

  return {
    ...summary,
    monitoring: summary.monitoring.map((item: Record<string, unknown>) => ({
      ...item,
      openingFloat: null,
      currentCashInHand: null,
      currentCashInAccount: null,
      currentTotalFloat: null,
      lastReceiptAt: null,
      lastReceiptUpdatedAt: null,
    })),
  };
}
import { DashboardCspDetailRepository } from "./repository/dashboard-csp-detail.repository";
import { addDays, istDateKey, istMonthKey } from "../../core/utils/ist";
import CashService from "../cash/cash.service";
import { DRAWER_KEYS, drawerTotal, emptyDrawer } from "../cash/cash.constants";

export default class DashboardService {
  private readonly overviewRepository: DashboardOverviewRepository;

  private readonly floatRepository: DashboardFloatRepository;

  private readonly serviceRepository: DashboardServiceRepository;

  private readonly machineRepository: DashboardMachineRepository;

  private readonly analyticsRepository: DashboardAnalyticsRepository;

  private readonly activationRepository: DashboardActivationRepository;

  private readonly subscriptionResolver: SubscriptionResolver;

  private readonly cspSummaryRepository: DashboardCspSummaryRepository;

  private readonly cspDetailRepository: DashboardCspDetailRepository;

  constructor(private readonly db: PrismaDb) {
    this.overviewRepository = new DashboardOverviewRepository(db);

    this.floatRepository = new DashboardFloatRepository(db);

    this.serviceRepository = new DashboardServiceRepository(db);

    this.machineRepository = new DashboardMachineRepository(db);

    this.analyticsRepository = new DashboardAnalyticsRepository(db);

    this.activationRepository = new DashboardActivationRepository(db);

    this.subscriptionResolver = new SubscriptionResolver(db);

    this.cspSummaryRepository = new DashboardCspSummaryRepository(db);

    this.cspDetailRepository = new DashboardCspDetailRepository(db);
  }

  async getSummary(filter: DashboardFilter) {
    const { from, to } = getDashboardDateRange(filter.from, filter.to);

    const dashboardFilter: DashboardFilter = {
      ...filter,
      from,
      to,
    };

    const [currentAgent, subscription] = await Promise.all([
      this.db.agent.findUnique({
        where: {
          agentId: dashboardFilter.currentAgentId,
        },
        select: {
          type: true,
        },
      }),

      this.subscriptionResolver.getEffectiveSubscription(
        dashboardFilter.currentAgentId,
      ),
    ]);

    const isBc = currentAgent?.type === "BC";

    SubscriptionAccessValidator.validate(subscription);

    const canViewFloat = await new SubscriptionEntitlementService(
      this.db,
    ).canViewCashManagement(subscription);
    // if (filter.agentIds.length === 0) {
    //   throw new BadRequestError("No accessible agents found.");
    // }
    const isSingleAgentView =
      filter.agentId !== undefined || filter.agentIds.length === 1;

    const [
      overview,
      floatSummary,
      serviceSummary,
      recentTransactions,
      statusSummary,
      machineSummary,
      activationSummary,
      activeSubscription,
      cspSummary,
      //   topServices,
    ] = await Promise.all([
      this.overviewRepository.getOverview(dashboardFilter),

      isSingleAgentView
        ? this.floatRepository.getFloatSummary(
            filter.agentId ?? filter.currentAgentId,
          )
        : null,

      this.serviceRepository.getServiceSummary(dashboardFilter),

      this.serviceRepository.getRecentTransactions(dashboardFilter),

      this.serviceRepository.getStatusSummary(dashboardFilter),

      isSingleAgentView
        ? this.machineRepository.getCspMachineSummary(dashboardFilter)
        : this.machineRepository.getMachineMonitoring(dashboardFilter),

      this.activationRepository.getActivationSummary(dashboardFilter),

      // Already resolved above for the access check.
      subscription,

      isBc
        ? this.cspSummaryRepository.getCspSummary(
            dashboardFilter.currentAgentId,
            dashboardFilter.from!,
            dashboardFilter.to!,
            dashboardFilter.agentIds,
          )
        : null,
      //   this.machineRepository.getCspMachineSummary(filter),
      //     filter.currentAgentId,
      //     filter.from,
      //     filter.to,
      //   ),

      //   this.serviceRepository.getTopServices(filter),
    ]);

    console.log("---- dashboard service ---");
    console.log({
      overview,

      floatSummary,

      serviceSummary,

      recentTransactions: mapRecentTransactions(recentTransactions),

      statusSummary,
    });
    return {
      overview: calculateOverview(overview),

      // float: mapFloatSummary(floatSummary),
      // Float figures are null for CSP plans without CASH_MANAGEMENT.
      ...(isSingleAgentView
        ? {
            float: canViewFloat ? mapFloatSummary(floatSummary) : null,

            machine: mapMachineSummary(machineSummary),
          }
        : {
            machineMonitoring: canViewFloat
              ? machineSummary
              : hideMonitoringFloat(machineSummary),
          }),

      services: mapServiceSummary(serviceSummary),

      servicesByCategory: mapServicesByCategory(serviceSummary),

      // Shared limit / cash in account per CSP, every agent's cash in hand and
      // drawer; null for CSP plans without CASH_MANAGEMENT.
      cash: canViewFloat ? await this.getCashSummary(dashboardFilter.agentIds) : null,

      statusSummary: mapStatusSummary(statusSummary),

      // machine: mapMachineSummary(machineSummary),

      //   topServices,

      activationSummary,

      recentTransactions,
      subscription: activeSubscription
        ? {
            subscriptionNumber: activeSubscription.subscriptionNumber,

            subscriptionType: activeSubscription.subscriptionType,

            status: activeSubscription.status,

            machineLimit: activeSubscription.machineLimit,

            amountPaid: Number(activeSubscription.amountPaid),

            startDate: activeSubscription.startDate,

            endDate: activeSubscription.endDate,

            graceEndsAt: activeSubscription.graceEndsAt,

            createdSource: activeSubscription.createdSource,
          }
        : null,

      ...(isBc
        ? {
            cspSummary,
          }
        : {}),
    };
  }

  /** Cash for the agents in view, grouped by their CSP's pool. */
  private async getCashSummary(agentIds: string[]) {
    // The super admin's whole-system view has no agent list; pick an agent.
    if (agentIds.length === 0) {
      return null;
    }

    const agents = await this.db.agent.findMany({
      where: { agentId: { in: agentIds }, type: { in: ["CSP", "KO"] } },
      select: { agentId: true, type: true, parentAgentId: true },
    });

    const cspIds = [
      ...new Set(
        agents
          .map((agent) => (agent.type === "CSP" ? agent.agentId : agent.parentAgentId))
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const pools = await new CashService(this.db).getViews(cspIds, agentIds);
    const drawer = emptyDrawer();

    for (const pool of pools) {
      for (const key of DRAWER_KEYS) {
        drawer[key] += pool.drawer[key];
      }
    }

    const sum = (pick: (pool: (typeof pools)[number]) => number | null) =>
      Number(pools.reduce((total, pool) => total + (pick(pool) ?? 0), 0).toFixed(2));

    return {
      totals: {
        cashLimit: sum((pool) => pool.cashLimit),
        cashInAccount: sum((pool) => pool.cashInAccount),
        cashInTransit: sum((pool) => pool.cashInTransit),
        cashLeftInBank: sum((pool) => pool.cashLeftInBank),
        cashOther: sum((pool) => pool.cashOther),
        cashDueExtra: sum((pool) => pool.cashDueExtra),
        totalCashInHand: sum((pool) => pool.totalCashInHand),
        drawer,
        drawerTotal: drawerTotal(drawer),
      },
      pools,
    };
  }

  async getAnalytics(filter: DashboardAnalyticsFilter) {
    const subscription =
      await this.subscriptionResolver.getEffectiveSubscription(
        filter.currentAgentId,
      );

    SubscriptionAccessValidator.validate(subscription);
    // if (filter.agentIds.length === 0) {
    //   throw new BadRequestError("No accessible agents found.");
    // }

    const [
      transactionTrend,
      successFailureTrend,
      serviceTrend,
      hourlyDistribution,
    ] = await Promise.all([
      this.analyticsRepository.getTransactionTrend(filter),

      this.analyticsRepository.getSuccessFailureTrend(filter),

      this.analyticsRepository.getServiceTrend(filter),

      this.analyticsRepository.getHourlyDistribution(filter),
    ]);

    return {
      transactionTrend: mapTransactionTrend(transactionTrend, filter.groupBy),

      successFailureTrend: mapSuccessFailureTrend(
        successFailureTrend,
        filter.groupBy,
      ),

      serviceTrend: mapServiceTrend(serviceTrend),

      hourlyDistribution: mapHourlyDistribution(hourlyDistribution),
    };
  }

  async getCspDetail({
    currentAgentId,
    agentId,
    from,
    to,
    section,
  }: {
    currentAgentId: string;
    agentId: string;
    from: Date;
    to: Date;
    section: "socialSecurity" | "transaction";
  }) {
    const subscription =
      await this.subscriptionResolver.getEffectiveSubscription(currentAgentId);

    SubscriptionAccessValidator.validate(subscription);

    const result = await this.cspDetailRepository.getCspDetail(
      currentAgentId,
      agentId,
      from,
      to,
    );

    if (!result) {
      throw new BadRequestError("CSP not found.");
    }

    if (section === "socialSecurity") {
      return {
        agentId: result.csp.agentId,
        cspName: result.csp.name,
        month: istMonthKey(from),
        section,
        socialSecurity: this.buildSocialSecurityDailyData(result, from, to),
      };
    }

    return {
      agentId: result.csp.agentId,
      cspName: result.csp.name,
      month: istMonthKey(from),
      section,
      transaction: this.buildTransactionDailyData(result, from, to),
    };
  }

  private buildSocialSecurityDailyData(
    result: Awaited<
      ReturnType<DashboardCspDetailRepository["getCspDetail"]>
    > extends infer T
      ? T extends null
        ? never
        : T
      : never,
    from: Date,
    to: Date,
  ) {
    const rows = [];

    const manualMap = new Map<string, number>();

    for (const value of result.manualMetricValues) {
      const dateKey = istDateKey(value.date);

      const key = `${dateKey}:${value.metricId}`;

      manualMap.set(key, (manualMap.get(key) ?? 0) + Number(value.value));
    }

    const receiptMap = new Map<string, number>();

    for (const receipt of result.receipts) {
      if (!receipt.transactionAt) {
        continue;
      }

      const dateKey = istDateKey(receipt.transactionAt);

      const keys = [receipt.receiptType, receipt.transactionCategory];

      for (const key of keys) {
        const mapKey = `${dateKey}:${key}`;

        receiptMap.set(mapKey, (receiptMap.get(mapKey) ?? 0) + receipt.count);
      }
    }

    for (
      let current = new Date(from);
      current <= to;
      current = addDays(current, 1)
    ) {
      const dateKey = istDateKey(current);

      const metrics = result.metricDefinitions.map((metric) => {
        let value = 0;

        if (metric.source === "MANUAL") {
          value = manualMap.get(`${dateKey}:${metric.id}`) ?? 0;
        } else {
          value = receiptMap.get(`${dateKey}:${metric.code}`) ?? 0;
        }

        return {
          code: metric.code,
          name: metric.name,
          value,
          source: metric.source,
        };
      });

      rows.push({
        date: dateKey,
        metrics,
      });
    }

    return rows;
  }

  private buildTransactionDailyData(
    result: Awaited<
      ReturnType<DashboardCspDetailRepository["getCspDetail"]>
    > extends infer T
      ? T extends null
        ? never
        : T
      : never,
    from: Date,
    to: Date,
  ) {
    const rows = [];

    for (
      let current = new Date(from);
      current <= to;
      current = addDays(current, 1)
    ) {
      const dateKey = istDateKey(current);

      const dayReceipts = result.receipts.filter(
        (receipt) =>
          receipt.transactionAt &&
          istDateKey(receipt.transactionAt) === dateKey,
      );

      const countOf = (category: string) =>
        dayReceipts
          .filter((receipt) => receipt.transactionCategory === category)
          .reduce((total, receipt) => total + receipt.count, 0);

      rows.push({
        date: dateKey,

        totalTxn: dayReceipts.reduce(
          (total, receipt) => total + receipt.count,
          0,
        ),

        passbookPrinter: countOf("PASSBOOK_PRINTING"),

        cashWithdrawal: countOf("CASH_WITHDRAWAL"),

        cashDeposit: countOf("CASH_DEPOSIT"),

        microAtmTxn: countOf("MICRO_ATM"),

        accountOpening: countOf("ACCOUNT_OPENING"),

        miniStatement: countOf("MINI_STATEMENT"),

        balanceInquiry: countOf("BALANCE_ENQUIRY"),

        moneyTransfer: countOf("MONEY_TRANSFER"),

        fundTransfer: countOf("FUND_TRANSFER"),
      });
    }

    return rows;
  }
}
