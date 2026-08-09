import { Prisma } from "../../../generated/prisma/client";

import { PrismaDb } from "../../../core/database/prisma.types";

import { ReportFilter } from "../report.dto";
import { normalizeDateRange } from "../../../core/utils/date-range.helper";

export default abstract class ReportCommonRepository {
  constructor(protected readonly db: PrismaDb) {}

  protected buildReceiptWhere(filter: ReportFilter): Prisma.ReceiptWhereInput {
    const { from, to } = normalizeDateRange(filter?.from, filter?.to);
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
            gte: from,
          }),

          ...(filter.to && {
            lte: to,
          }),
        },
      }),
    };
  }
}
