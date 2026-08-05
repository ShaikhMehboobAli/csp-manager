import { PrismaDb } from "../../../core/database/prisma.types";
import { Prisma } from "../../../generated/prisma/client";

import { DashboardFilter } from "../dashboard.types";

export default abstract class DashboardCommonRepository {
  constructor(protected readonly db: PrismaDb) {}

  protected buildReceiptWhere(
    filter: DashboardFilter,
  ): Prisma.ReceiptWhereInput {
    return {
      ...(filter.agentId && {
        agentId: filter.agentId,
      }),

      ...(filter.machineId && {
        machineId: filter.machineId,
      }),

      ...(filter.receiptType && {
        receiptType: filter.receiptType,
      }),

      ...(filter.transactionCategory && {
        transactionCategory: filter.transactionCategory,
      }),

      ...((filter.from || filter.to) && {
        transactionAt: {
          ...(filter.from && {
            gte: filter.from,
          }),

          ...(filter.to && {
            lte: filter.to,
          }),
        },
      }),
    };
  }
}
