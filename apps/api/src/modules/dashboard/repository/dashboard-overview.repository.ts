import { PrismaDb } from "../../../core/database/prisma.types";

import { ReceiptStatus } from "../../../generated/prisma/enums";

import { DashboardFilter } from "../dashboard.types";

import DashboardCommonRepository from "./dashboard-common.repository";

export default class DashboardOverviewRepository extends DashboardCommonRepository {
  constructor(db: PrismaDb) {
    super(db);
  }

  // From the daily counts, so totals survive receipt retention.
  async getOverview(filter: DashboardFilter) {
    const byStatus = await this.db.receiptDailyCount.groupBy({
      by: ["status"],

      where: this.buildCountWhere(filter),

      _sum: {
        count: true,
        amount: true,
      },

      _max: {
        lastTransactionAt: true,
      },
    });

    const countOf = (status: ReceiptStatus) =>
      byStatus.find((row) => row.status === status)?._sum.count ?? 0;

    const lastTransactionAt = byStatus.reduce<Date | null>(
      (latest, row) =>
        row._max.lastTransactionAt &&
        (!latest || row._max.lastTransactionAt > latest)
          ? row._max.lastTransactionAt
          : latest,
      null,
    );

    return {
      totalTransactions: byStatus.reduce(
        (total, row) => total + (row._sum.count ?? 0),
        0,
      ),

      successfulTransactions: countOf(ReceiptStatus.SUCCESS),

      failedTransactions: countOf(ReceiptStatus.FAILED),

      totalTransactionAmount: Number(
        byStatus.find((row) => row.status === ReceiptStatus.SUCCESS)?._sum
          .amount ?? 0,
      ),

      lastTransactionAt,
    };
  }
}
