import { PrismaDb } from "../../../core/database/prisma.types";

import ReceiptCommonRepository from "./receipt-common.repository";

import { ReceiptFilter } from "../receipt.dto";
import { buildPagination } from "../receipt.helper";

export default class ReceiptListRepository extends ReceiptCommonRepository {
  constructor(db: PrismaDb) {
    super(db);
  }

  async getReceipts(filter: ReceiptFilter) {
    const where = this.buildReceiptWhere(filter);

    const page = filter.page;

    const limit = filter.limit;

    const skip = (page - 1) * limit;

    const orderBy = {
      [filter.sortBy]: filter.sortOrder,
    } as const;

    const [items, total] = await Promise.all([
      this.db.receipt.findMany({
        where,

        skip,

        take: limit,

        orderBy,

        select: {
          receiptId: true,

          receiptType: true,

          transactionCategory: true,

          status: true,

          amount: true,

          transactionAt: true,

          createdAt: true,

          customerName: true,

          customerAccount: true,

          rrn: true,

          stan: true,

          agentId: true,

          machine: {
            select: {
              machineCode: true,

              machineName: true,
            },
          },
        },
      }),

      this.db.receipt.count({
        where,
      }),
    ]);

    return {
      items,

      pagination: buildPagination(page, limit, total),
    };
  }

  /**
   * Receipt Statistics
   */
  async getStats(filter: ReceiptFilter) {
    const where = this.buildReceiptWhere(filter);

    const [total, success, failed, totalAmount] = await Promise.all([
      this.db.receipt.count({
        where,
      }),

      this.db.receipt.count({
        where: {
          ...where,

          status: "SUCCESS",
        },
      }),

      this.db.receipt.count({
        where: {
          ...where,

          status: "FAILED",
        },
      }),

      this.db.receipt.aggregate({
        where: {
          ...where,

          status: "SUCCESS",
        },

        _sum: {
          amount: true,
        },
      }),
    ]);

    return {
      total,

      success,

      failed,

      totalAmount: Number(totalAmount._sum.amount ?? 0),
    };
  }
}
