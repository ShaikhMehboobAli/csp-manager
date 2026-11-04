import { PrismaDb } from "../../../core/database/prisma.types";
import { normalizeDateRange } from "../../../core/utils/date-range.helper";
import { buildDailyCountWhere } from "./receipt-daily-count.repository";

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
    // A text search needs the receipts (retention period only); otherwise
    // the daily counts give the same totals for up to a year.
    if (!filter.search) {
      return this.getStatsFromDailyCounts(filter);
    }

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
          commissionAmount: true,
        },
      }),
    ]);

    return {
      total,

      success,

      failed,

      totalAmount: Number(totalAmount._sum.amount ?? 0),

      // What the CSP earned on these receipts.
      commissionAmount: Number(totalAmount._sum.commissionAmount ?? 0),
    };
  }

  private async getStatsFromDailyCounts(filter: ReceiptFilter) {
    const { from, to } = normalizeDateRange(filter.from, filter.to);

    const byStatus = await this.db.receiptDailyCount.groupBy({
      by: ["status"],

      where: buildDailyCountWhere({
        agentId: filter.agentId,
        agentIds: filter.agentIds,
        machineId: filter.machineId,
        receiptType: filter.receiptType,
        receiptTypes: filter.receiptTypes,
        transactionCategory: filter.transactionCategory,
        transactionCategories: filter.transactionCategories,
        status: filter.status,
        from: filter.from && from,
        to: filter.to && to,
      }),

      _sum: {
        count: true,

        amount: true,

        commissionAmount: true,
      },
    });

    const of = (status: string) =>
      byStatus.find((row) => row.status === status)?._sum;

    return {
      total: byStatus.reduce((total, row) => total + (row._sum.count ?? 0), 0),

      success: of("SUCCESS")?.count ?? 0,

      failed: of("FAILED")?.count ?? 0,

      totalAmount: Number(of("SUCCESS")?.amount ?? 0),

      commissionAmount: Number(of("SUCCESS")?.commissionAmount ?? 0),
    };
  }

  async exportReceipts(filter: ReceiptFilter) {
    return this.db.receipt.findMany({
      where: this.buildReceiptWhere(filter),

      orderBy: {
        transactionAt: "desc",
      },

      select: {
        receiptId: true,

        agentId: true,

        receiptType: true,

        transactionCategory: true,

        status: true,

        amount: true,

        customerName: true,

        customerAccount: true,

        rrn: true,

        stan: true,

        transactionAt: true,

        machine: {
          select: {
            machineCode: true,
          },
        },
      },
    });
  }
}
