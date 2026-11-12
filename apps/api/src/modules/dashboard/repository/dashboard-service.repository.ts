import { PrismaDb } from "../../../core/database/prisma.types";

import { asReceiptGroups } from "../../receipts/repository/receipt-daily-count.repository";

import DashboardCommonRepository from "./dashboard-common.repository";

import { DashboardFilter } from "../dashboard.types";

const DASHBOARD_RECENT_TRANSACTION_LIMIT = 5;

export default class DashboardServiceRepository extends DashboardCommonRepository {
  constructor(db: PrismaDb) {
    super(db);
  }

  /**
   * Service Summary
   */
  async getServiceSummary(filter: DashboardFilter) {
    const rows = await this.db.receiptDailyCount.groupBy({
      by: ["transactionCategory", "receiptType", "status"],

      where: this.buildCountWhere(filter),

      _sum: {
        count: true,
        amount: true,
      },

      orderBy: {
        transactionCategory: "asc",
      },
    });

    return asReceiptGroups(rows);
  }

  /**
   * Overall Status Summary
   */
  async getStatusSummary(filter: DashboardFilter) {
    const rows = await this.db.receiptDailyCount.groupBy({
      by: ["status"],

      where: this.buildCountWhere(filter),

      _sum: {
        count: true,
      },
    });

    return asReceiptGroups(rows);
  }

  /**
   * Recent Transactions (receipts, so within the retention period)
   */
  async getRecentTransactions(filter: DashboardFilter) {
    return this.db.receipt.findMany({
      where: this.buildReceiptWhere(filter),

      orderBy: {
        transactionAt: "desc",
      },

      take: DASHBOARD_RECENT_TRANSACTION_LIMIT,

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
    const rows = await this.db.receiptDailyCount.groupBy({
      by: ["transactionCategory"],

      where: this.buildCountWhere(filter),

      _sum: {
        count: true,
        amount: true,
      },

      orderBy: {
        _sum: {
          count: "desc",
        },
      },

      take: DASHBOARD_RECENT_TRANSACTION_LIMIT,
    });

    return asReceiptGroups(rows);
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
