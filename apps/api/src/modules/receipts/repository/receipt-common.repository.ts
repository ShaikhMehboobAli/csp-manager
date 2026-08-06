import { Prisma } from "../../../generated/prisma/client";

import { PrismaDb } from "../../../core/database/prisma.types";

import { ReceiptFilter } from "../receipt.dto";

export default abstract class ReceiptCommonRepository {
  constructor(protected readonly db: PrismaDb) {}

  protected buildReceiptWhere(filter: ReceiptFilter): Prisma.ReceiptWhereInput {
    const where: Prisma.ReceiptWhereInput = {};

    /**
     * Agent Scope
     */
    // if (filter.agentIds.length > 0) {
    if ((filter.agentIds ?? []).length > 0) {
      where.agentId = {
        in: filter.agentIds,
      };
    }

    /**
     * Machine
     */
    if (filter.machineId) {
      where.machineId = filter.machineId;
    }

    /**
     * Receipt Type
     */
    if (filter.receiptType) {
      where.receiptType = filter.receiptType;
    }

    /**
     * Transaction Category
     */
    if (filter.transactionCategory) {
      where.transactionCategory = filter.transactionCategory;
    }

    /**
     * Status
     */
    if (filter.status) {
      where.status = filter.status;
    }

    /**
     * Date Range
     */
    if (filter.from || filter.to) {
      where.transactionAt = {
        ...(filter.from && {
          gte: filter.from,
        }),

        ...(filter.to && {
          lte: filter.to,
        }),
      };
    }

    /**
     * Global Search
     */
    if (filter.search) {
      where.OR = [
        {
          receiptId: {
            contains: filter.search,
            mode: Prisma.QueryMode.insensitive,
          },
        },

        {
          customerName: {
            contains: filter.search,
            mode: Prisma.QueryMode.insensitive,
          },
        },

        {
          customerAccount: {
            contains: filter.search,
            mode: Prisma.QueryMode.insensitive,
          },
        },

        {
          rrn: {
            contains: filter.search,
            mode: Prisma.QueryMode.insensitive,
          },
        },

        {
          stan: {
            contains: filter.search,
            mode: Prisma.QueryMode.insensitive,
          },
        },
      ];
    }

    return where;
  }
}
