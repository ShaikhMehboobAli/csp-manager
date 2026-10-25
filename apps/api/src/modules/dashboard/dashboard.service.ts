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

        receiptMap.set(mapKey, (receiptMap.get(mapKey) ?? 0) + 1);
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
          receipt.transactionAt && istDateKey(receipt.transactionAt) === dateKey,
      );

      rows.push({
        date: dateKey,

        totalTxn: dayReceipts.length,

        passbookPrinter: 0,

        cashWithdrawal: dayReceipts.filter(
          (receipt) => receipt.transactionCategory === "CASH_WITHDRAWAL",
        ).length,

        cashDeposit: dayReceipts.filter(
          (receipt) => receipt.transactionCategory === "CASH_DEPOSIT",
        ).length,

        microAtmTxn: dayReceipts.filter(
          (receipt) => receipt.transactionCategory === "MICRO_ATM",
        ).length,

        accountOpening: dayReceipts.filter(
          (receipt) => receipt.transactionCategory === "ACCOUNT_OPENING",
        ).length,

        miniStatement: dayReceipts.filter(
          (receipt) => receipt.transactionCategory === "MINI_STATEMENT",
        ).length,

        balanceInquiry: dayReceipts.filter(
          (receipt) => receipt.transactionCategory === "BALANCE_ENQUIRY",
        ).length,

        moneyTransfer: dayReceipts.filter(
          (receipt) => receipt.transactionCategory === "MONEY_TRANSFER",
        ).length,

        fundTransfer: dayReceipts.filter(
          (receipt) => receipt.transactionCategory === "FUND_TRANSFER",
        ).length,
      });
    }

    return rows;
  }
}
