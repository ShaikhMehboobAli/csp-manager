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

export default class DashboardService {
  private readonly overviewRepository: DashboardOverviewRepository;

  private readonly floatRepository: DashboardFloatRepository;

  private readonly serviceRepository: DashboardServiceRepository;

  private readonly machineRepository: DashboardMachineRepository;

  private readonly analyticsRepository: DashboardAnalyticsRepository;

  private readonly activationRepository: DashboardActivationRepository;

  constructor(private readonly db: PrismaDb) {
    this.overviewRepository = new DashboardOverviewRepository(db);

    this.floatRepository = new DashboardFloatRepository(db);

    this.serviceRepository = new DashboardServiceRepository(db);

    this.machineRepository = new DashboardMachineRepository(db);

    this.analyticsRepository = new DashboardAnalyticsRepository(db);

    this.activationRepository = new DashboardActivationRepository(db);
  }

  async getSummary(filter: DashboardFilter) {
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
      //   topServices,
    ] = await Promise.all([
      this.overviewRepository.getOverview(filter),

      this.floatRepository.getFloatSummary(filter.currentAgentId),

      this.serviceRepository.getServiceSummary(filter),

      this.serviceRepository.getRecentTransactions(filter),

      this.serviceRepository.getStatusSummary(filter),

      isSingleAgentView
        ? await this.machineRepository.getCspMachineSummary(filter)
        : await this.machineRepository.getMachineMonitoring(filter),

      this.activationRepository.getActivationSummary(filter),
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

      float: mapFloatSummary(floatSummary),

      services: mapServiceSummary(serviceSummary),

      statusSummary: mapStatusSummary(statusSummary),

      machine: mapMachineSummary(machineSummary),

      //   topServices,

      activationSummary,

      recentTransactions,
    };
  }

  async getAnalytics(filter: DashboardAnalyticsFilter) {
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
