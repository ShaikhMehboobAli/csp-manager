import { PrismaDb } from "../../../core/database/prisma.types";

import DashboardCommonRepository from "./dashboard-common.repository";

export default class DashboardFloatRepository extends DashboardCommonRepository {
  constructor(db: PrismaDb) {
    super(db);
  }

  /**
   * Current Float Summary
   */
  async getFloatSummary(agentId: string) {
    return this.db.agentFloat.findUnique({
      where: {
        agentId,
      },

      select: {
        openingFloat: true,

        currentCashInHand: true,

        currentCashInAccount: true,

        currentTotalFloat: true,

        lastReceiptAt: true,

        updatedAt: true,
      },
    });
  }

  /**
   * Future:
   * Float Adjustment History
   */
  async getAdjustmentHistory(agentId: string) {
    return this.db.floatAdjustmentRequest.findMany({
      where: {
        agentId,
      },

      orderBy: {
        createdAt: "desc",
      },

      take: 10,
    });
  }

  /**
   * Future:
   * Latest Ledger
   */
  async getLatestLedger(agentId: string) {
    return this.db.floatLedger.findFirst({
      where: {
        agentId,
      },

      orderBy: {
        createdAt: "desc",
      },
    });
  }
}
