import { PrismaDb } from "../../../core/database/prisma.types";

import { ReceiptStatus } from "../../../generated/prisma/enums";

import { DashboardFilter } from "../dashboard.types";

import DashboardCommonRepository from "./dashboard-common.repository";

export default class DashboardOverviewRepository extends DashboardCommonRepository {
  constructor(db: PrismaDb) {
    super(db);
  }

  async getOverview(filter: DashboardFilter) {
    const where = this.buildReceiptWhere(filter);

    const [
      totalTransactions,
      successfulTransactions,
      failedTransactions,
      successfulAmount,
      lastTransaction,
    ] = await Promise.all([
      this.db.receipt.count({
        where,
      }),

      this.db.receipt.count({
        where: {
          ...where,
          status: ReceiptStatus.SUCCESS,
        },
      }),

      this.db.receipt.count({
        where: {
          ...where,
          status: ReceiptStatus.FAILED,
        },
      }),

      this.db.receipt.aggregate({
        where: {
          ...where,
          status: ReceiptStatus.SUCCESS,
        },

        _sum: {
          amount: true,
        },
      }),

      this.db.receipt.findFirst({
        where,

        orderBy: {
          transactionAt: "desc",
        },

        select: {
          transactionAt: true,
        },
      }),
    ]);

    return {
      totalTransactions,

      successfulTransactions,

      failedTransactions,

      totalTransactionAmount: Number(successfulAmount._sum.amount ?? 0),

      lastTransactionAt: lastTransaction?.transactionAt ?? null,
    };
  }
}
