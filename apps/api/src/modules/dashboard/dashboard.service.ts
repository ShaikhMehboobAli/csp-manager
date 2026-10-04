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

export default class DashboardService {
  private readonly overviewRepository: DashboardOverviewRepository;

  private readonly floatRepository: DashboardFloatRepository;

  private readonly serviceRepository: DashboardServiceRepository;

  private readonly machineRepository: DashboardMachineRepository;

  private readonly analyticsRepository: DashboardAnalyticsRepository;

  private readonly activationRepository: DashboardActivationRepository;

  private readonly subscriptionResolver: SubscriptionResolver;

  private readonly cspSummaryRepository: DashboardCspSummaryRepository;

  constructor(private readonly db: PrismaDb) {
    this.overviewRepository = new DashboardOverviewRepository(db);

    this.floatRepository = new DashboardFloatRepository(db);

    this.serviceRepository = new DashboardServiceRepository(db);

    this.machineRepository = new DashboardMachineRepository(db);

    this.analyticsRepository = new DashboardAnalyticsRepository(db);

    this.activationRepository = new DashboardActivationRepository(db);

    this.subscriptionResolver = new SubscriptionResolver(db);

    this.cspSummaryRepository = new DashboardCspSummaryRepository(db);
  }

  async getSummary(filter: DashboardFilter) {
    const { from, to } = getDashboardDateRange(filter.from, filter.to);

    const dashboardFilter: DashboardFilter = {
      ...filter,
      from,
      to,
    };

    const currentAgent = await this.db.agent.findUnique({
      where: {
        agentId: dashboardFilter.currentAgentId,
      },
      select: {
        type: true,
      },
    });

    const isBc = currentAgent?.type === "BC";

    const subscription =
      await this.subscriptionResolver.getEffectiveSubscription(
        dashboardFilter.currentAgentId,
      );

    SubscriptionAccessValidator.validate(subscription);
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
      this.subscriptionResolver.getEffectiveSubscription(filter.currentAgentId),

      isBc
        ? this.cspSummaryRepository.getCspSummary(
            dashboardFilter.currentAgentId,
            dashboardFilter.from!,
            dashboardFilter.to!,
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
      ...(isSingleAgentView
        ? {
            float: mapFloatSummary(floatSummary),

            machine: mapMachineSummary(machineSummary),
          }
        : {
            machineMonitoring: machineSummary,
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
}
