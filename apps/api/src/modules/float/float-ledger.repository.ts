import { PrismaDb } from "../../core/database/prisma.types";

import {
  FloatLedger,
  FloatLedgerType,
  Prisma,
} from "../../generated/prisma/client";

export default class FloatLedgerRepository {
  constructor(private readonly db: PrismaDb) {}

  async findLatestLedger(agentId: string) {
    return this.db.floatLedger.findFirst({
      where: {
        agentId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async create(data: Prisma.FloatLedgerCreateInput) {
    return this.db.floatLedger.create({
      data,
    });
  }

  async findByReceiptId(receiptId: string) {
    return this.db.floatLedger.findFirst({
      where: {
        receiptId,
      },
    });
  }

  async findByAgent(agentId: string) {
    return this.db.floatLedger.findMany({
      where: {
        agentId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  //   async createOpeningLedger(
  //     agentId: string,
  //     cashInHand: number,
  //     cashInAccount: number,
  //   ) {
  //     return this.create({
  //       ledgerType: FloatLedgerType.OPENING,

  //       cashInHandChange: cashInHand,

  //       cashInAccountChange: cashInAccount,

  //       balanceCashInHand: cashInHand,

  //       balanceCashInAccount: cashInAccount,

  //       remarks: "Initial opening float",

  //       agent: {
  //         connect: {
  //           agentId,
  //         },
  //       },
  //     });
  //   }
}
