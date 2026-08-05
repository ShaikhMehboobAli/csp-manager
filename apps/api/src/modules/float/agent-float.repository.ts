import { PrismaDb } from "../../core/database/prisma.types";

import { Prisma } from "../../generated/prisma/client";

export default class AgentFloatRepository {
  constructor(private readonly db: PrismaDb) {}

  async findByAgentId(agentId: string) {
    return this.db.agentFloat.findUnique({
      where: {
        agentId,
      },
    });
  }

  async create(data: Prisma.AgentFloatCreateInput) {
    return this.db.agentFloat.create({
      data,
    });
  }

  async update(agentId: string, data: Prisma.AgentFloatUpdateInput) {
    return this.db.agentFloat.update({
      where: {
        agentId,
      },
      data,
    });
  }

  async initialize(agentId: string, cashInHand: number, cashInAccount: number) {
    return this.db.agentFloat.create({
      data: {
        openingFloat: cashInHand + cashInAccount,

        currentCashInHand: cashInHand,

        currentCashInAccount: cashInAccount,

        currentTotalFloat: cashInHand + cashInAccount,

        approvalStatus: "APPROVED",

        agent: {
          connect: {
            agentId,
          },
        },
      },
    });
  }
}
