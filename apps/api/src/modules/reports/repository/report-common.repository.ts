import { Prisma } from "../../../generated/prisma/client";

import { PrismaDb } from "../../../core/database/prisma.types";

import { ReportFilter } from "../report.dto";

export default abstract class ReportCommonRepository {
  constructor(protected readonly db: PrismaDb) {}

  protected buildReceiptWhere(filter: ReportFilter): Prisma.ReceiptWhereInput {
    return {
      //   ...(filter.agentIds.length > 0 && {
      //     agentId: {
      //       in: filter.agentIds,
      //     },
      //   }),
      ...(filter.agentId
        ? {
            agentId: filter.agentId,
          }
        : filter.agentIds?.length
          ? {
              agentId: {
                in: filter.agentIds,
              },
            }
          : {}),

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
