import { PrismaDb } from "../../../core/database/prisma.types";

import { DashboardFilter } from "../dashboard.types";
import DashboardCommonRepository from "./dashboard-common.repository";

export default class DashboardAnalyticsRepository {
  constructor(private readonly db: PrismaDb) {}
  //   constructor(db: PrismaDb) {
  //     super(db);
  //   }

  private buildWhere(filter: DashboardFilter) {
    return {
      //   ...(filter.agentId && {
      //     agentId: filter.agentId,
      //   }),

      ...(filter.agentIds?.length
        ? {
            agentId: {
              in: filter.agentIds,
            },
          }
        : {}),

      ...(filter.machineId && {
        machineId: filter.machineId,
      }),

      ...(filter.receiptType && {
        receiptType: filter.receiptType,
      }),

      ...(filter.transactionCategory && {
        transactionCategory: filter.transactionCategory,
      }),

      ...(filter.from &&
        filter.to && {
          transactionAt: {
            gte: filter.from,
            lte: filter.to,
          },
        }),
    };
  }

  /**
   * Transaction Trend
   */
  async getTransactionTrend(filter: DashboardFilter) {
    return this.db.receipt.findMany({
      where: this.buildWhere(filter),

      select: {
        transactionAt: true,

        amount: true,
      },

      orderBy: {
        transactionAt: "asc",
      },
    });
  }

  async getSuccessFailureTrend(filter: DashboardFilter) {
    return this.db.receipt.findMany({
      where: this.buildWhere(filter),

      select: {
        transactionAt: true,

        status: true,
      },

      orderBy: {
        transactionAt: "asc",
      },
    });
  }

  async getServiceTrend(filter: DashboardFilter) {
    return this.db.receipt.groupBy({
      by: ["transactionCategory"],

      where: this.buildWhere(filter),

      _count: {
        id: true,
      },

      _sum: {
        amount: true,
      },

      orderBy: {
        transactionCategory: "asc",
      },
    });
  }

  async getHourlyDistribution(filter: DashboardFilter) {
    return this.db.receipt.findMany({
      where: this.buildWhere(filter),

      select: {
        transactionAt: true,
      },
    });
  }
}
