import { PrismaDb } from "../../../core/database/prisma.types";
import { Prisma } from "../../../generated/prisma/client";

import { DashboardFilter } from "../dashboard.types";

export default abstract class DashboardCommonRepository {
  constructor(protected readonly db: PrismaDb) {}

  //   protected buildReceiptWhere(
  //     filter: DashboardFilter,
  //   ): Prisma.ReceiptWhereInput {
  //     return {
  //       //   ...(filter.agentId && {
  //       //     agentId: filter.agentId,
  //       //   }),

  //       ...(filter.agentIds.length
  //         ? {
  //             agentId: {
  //               in: filter.agentIds,
  //             },
  //           }
  //         : {}),

  //       ...(filter.machineId && {
  //         machineId: filter.machineId,
  //       }),

  //       ...(filter.receiptType && {
  //         receiptType: filter.receiptType,
  //       }),

  //       ...(filter.transactionCategory && {
  //         transactionCategory: filter.transactionCategory,
  //       }),

  //       ...((filter.from || filter.to) && {
  //         transactionAt: {
  //           ...(filter.from && {
  //             gte: filter.from,
  //           }),

  //           ...(filter.to && {
  //             lte: filter.to,
  //           }),
  //         },
  //       }),
  //     };
  //   }

  protected buildReceiptWhere(
    filter: DashboardFilter,
  ): Prisma.ReceiptWhereInput {
    const where: Prisma.ReceiptWhereInput = {};

    if (filter.agentIds.length > 0) {
      where.agentId = {
        in: filter.agentIds,
      };
    }

    if (filter.machineId) {
      where.machineId = filter.machineId;
    }

    if (filter.receiptType) {
      where.receiptType = filter.receiptType;
    }

    if (filter.transactionCategory) {
      where.transactionCategory = filter.transactionCategory;
    }

    if (filter.from || filter.to) {
      where.transactionAt = {
        ...(filter.from && { gte: filter.from }),
        ...(filter.to && { lte: filter.to }),
      };
    }

    return where;
  }
}
