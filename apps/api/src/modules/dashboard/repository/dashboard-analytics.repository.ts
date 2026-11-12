import { PrismaDb } from "../../../core/database/prisma.types";
import { normalizeDateRange } from "../../../core/utils/date-range.helper";

import { fromIstCalendarDate } from "../../../core/utils/ist";
import {
  asReceiptGroups,
  buildDailyCountWhere,
} from "../../receipts/repository/receipt-daily-count.repository";

import { DashboardAnalyticsFilter, DashboardFilter } from "../dashboard.types";

export default class DashboardAnalyticsRepository {
  constructor(private readonly db: PrismaDb) {}
  //   constructor(db: PrismaDb) {
  //     super(db);
  //   }

  private buildWhere(filter: DashboardFilter) {
    const { from, to } = normalizeDateRange(filter?.from, filter?.to);
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

      transactionAt: {
        gte: from,
        lte: to,
      },
    };
  }

  private buildCountWhere(filter: DashboardFilter) {
    const { from, to } = normalizeDateRange(filter?.from, filter?.to);

    return buildDailyCountWhere({
      agentIds: filter.agentIds,
      machineId: filter.machineId,
      receiptType: filter.receiptType,
      transactionCategory: filter.transactionCategory,
      from,
      to,
    });
  }

  /**
   * Transaction Trend. Day and longer buckets come from the daily counts;
   * hourly buckets need receipt times, so they cover the retention period.
   */
  async getTransactionTrend(filter: DashboardAnalyticsFilter) {
    if (filter.groupBy !== "hour") {
      const days = await this.db.receiptDailyCount.groupBy({
        by: ["date"],
        where: this.buildCountWhere(filter),
        _sum: { count: true, amount: true },
        orderBy: { date: "asc" },
      });

      return days.map((day) => ({
        transactionAt: fromIstCalendarDate(day.date),
        amount: day._sum.amount,
        count: day._sum.count ?? 0,
      }));
    }

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

  async getSuccessFailureTrend(filter: DashboardAnalyticsFilter) {
    if (filter.groupBy !== "hour") {
      const days = await this.db.receiptDailyCount.groupBy({
        by: ["date", "status"],
        where: this.buildCountWhere(filter),
        _sum: { count: true },
        orderBy: { date: "asc" },
      });

      return days.map((day) => ({
        transactionAt: fromIstCalendarDate(day.date),
        status: day.status,
        count: day._sum.count ?? 0,
      }));
    }

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
    const rows = await this.db.receiptDailyCount.groupBy({
      by: ["transactionCategory"],

      where: this.buildCountWhere(filter),

      _sum: {
        count: true,
        amount: true,
      },

      orderBy: {
        transactionCategory: "asc",
      },
    });

    return asReceiptGroups(rows);
  }

  // Needs receipt times, so it covers the retention period only.
  async getHourlyDistribution(filter: DashboardFilter) {
    return this.db.receipt.findMany({
      where: this.buildWhere(filter),

      select: {
        transactionAt: true,
      },
    });
  }
}
