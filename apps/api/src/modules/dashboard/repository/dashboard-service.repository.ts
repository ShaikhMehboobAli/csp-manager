import { PrismaDb } from "../../../core/database/prisma.types";

import DashboardCommonRepository from "./dashboard-common.repository";

import { DashboardFilter } from "../dashboard.types";

export default class DashboardServiceRepository extends DashboardCommonRepository {
  constructor(db: PrismaDb) {
    super(db);
  }

  /**
   * Service Summary
   */
  async getServiceSummary(filter: DashboardFilter) {
    return this.db.receipt.groupBy({
      by: ["transactionCategory", "receiptType", "status"],

      where: this.buildReceiptWhere(filter),

      _count: {
        id: true,
      },

      _sum: {
        amount: true,
      },

      orderBy: {
        transactionCategory: "asc",
      },
    });
  }

  /**
   * Overall Status Summary
   */
  async getStatusSummary(filter: DashboardFilter) {
    return this.db.receipt.groupBy({
      by: ["status"],

      where: this.buildReceiptWhere(filter),

      _count: {
        id: true,
      },
    });
  }

  /**
   * Recent Transactions
   */
  async getRecentTransactions(filter: DashboardFilter) {
    return this.db.receipt.findMany({
      where: this.buildReceiptWhere(filter),

      orderBy: {
        transactionAt: "desc",
      },

      take: 10,

      select: {
        receiptId: true,

        receiptType: true,

        transactionCategory: true,

        status: true,

        amount: true,

        transactionAt: true,

        customerName: true,

        customerAccount: true,

        rrn: true,

        stan: true,
      },
    });
  }

  /**
   * Top Services
   */
  async getTopServices(filter: DashboardFilter) {
    return this.db.receipt.groupBy({
      by: ["transactionCategory"],

      where: this.buildReceiptWhere(filter),

      _count: {
        id: true,
      },

      _sum: {
        amount: true,
      },

      orderBy: {
        _count: {
          id: "desc",
        },
      },

      take: 10,
    });
  }

  //   async getMachineSummary(machineId: string) {
  //     return this.db.machine.findUnique({
  //       where: {
  //         id: machineId,
  //       },
  //       select: {
  //         machineCode: true,
  //         status: true,
  //         lastHeartbeatAt: true,
  //         lastTransactionAt: true,
  //         createdAt: true,
  //       },
  //     });
  //   }
}
