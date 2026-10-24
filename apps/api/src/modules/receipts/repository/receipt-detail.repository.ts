import { PrismaDb } from "../../../core/database/prisma.types";

import ReceiptCommonRepository from "./receipt-common.repository";

export default class ReceiptDetailRepository extends ReceiptCommonRepository {
  constructor(db: PrismaDb) {
    super(db);
  }

  async getReceipt(receiptId: string, agentIds: string[]) {
    return this.db.receipt.findFirst({
      where: {
        receiptId,

        ...(agentIds.length > 0 && {
          agentId: {
            in: agentIds,
          },
        }),
      },

      include: {
        machine: {
          select: {
            machineCode: true,

            machineName: true,
          },
        },

        agent: {
          select: {
            agentId: true,

            name: true,

            type: true,
          },
        },

        cashDenomination: true,
      },
    });
  }
}
