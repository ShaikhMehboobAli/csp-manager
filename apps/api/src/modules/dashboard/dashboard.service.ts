import { PrismaDb } from "../../core/database/prisma.types";

import DashboardOverviewRepository from "./repository/dashboard-overview.repository";
import DashboardFloatRepository from "./repository/dashboard-float.repository";
import DashboardServiceRepository from "./repository/dashboard-service.repository";

import { DashboardFilter } from "./dashboard.types";

import {
  calculateOverview,
  mapFloatSummary,
  mapRecentTransactions,
  mapServiceSummary,
  mapStatusSummary,
} from "./dashboard.mapper";
import { BadRequestError } from "../../core/errors/BadRequestError";
import DashboardMachineRepository from "./repository/dashboard-machine.repository";
import { getMachineStatus } from "./dashboard.helper";

export default class DashboardService {
  private readonly overviewRepository: DashboardOverviewRepository;

  private readonly floatRepository: DashboardFloatRepository;

  private readonly serviceRepository: DashboardServiceRepository;

  private readonly machineRepository: DashboardMachineRepository;

  constructor(private readonly db: PrismaDb) {
    this.overviewRepository = new DashboardOverviewRepository(db);

    this.floatRepository = new DashboardFloatRepository(db);

    this.serviceRepository = new DashboardServiceRepository(db);

    this.machineRepository = new DashboardMachineRepository(db);
  }

  async getSummary(filter: DashboardFilter) {
    if (!filter.agentId) {
      throw new BadRequestError("Agent Id is required.");
    }

    const agentId = filter.agentId;

    const [
      overview,
      floatSummary,
      serviceSummary,
      recentTransactions,
      statusSummary,
      machineSummary,
      //   topServices,
    ] = await Promise.all([
      this.overviewRepository.getOverview(filter),

      this.floatRepository.getFloatSummary(agentId),

      this.serviceRepository.getServiceSummary(filter),

      this.serviceRepository.getRecentTransactions(filter),

      this.serviceRepository.getStatusSummary(filter),

      this.machineRepository.getMachineSummary(agentId, filter.from, filter.to),

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

      machine: machineSummary && {
        machineStartedAt: machineSummary.machineStartedAt,

        firstReceiptCapturedAt: machineSummary.firstReceiptCapturedAt,

        lastReceiptCapturedAt: machineSummary.lastReceiptCapturedAt,

        receiptWatcherVersion: machineSummary.watcherVersion,

        lastHeartbeatAt: machineSummary.lastHeartbeatAt,

        connectionStatus: getMachineStatus(machineSummary.lastHeartbeatAt),
        machineStatus: machineSummary.status,
      },

      //   topServices,

      recentTransactions,
    };
  }
}
