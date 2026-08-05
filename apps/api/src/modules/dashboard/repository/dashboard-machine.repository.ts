import { PrismaDb } from "../../../core/database/prisma.types";
import { getTodayRange } from "../dashboard.helper";

export default class DashboardMachineRepository {
  constructor(private readonly db: PrismaDb) {}

  //   async getMachineSummary(agentId: string, from?: Date, to?: Date) {
  //     const machine = await this.db.machine.findFirst({
  //       where: {
  //         agentId,
  //         isDeleted: false,
  //       },

  //       orderBy: {
  //         updatedAt: "desc",
  //       },

  //       select: {
  //         id: true,

  //         watcherVersion: true,

  //         lastHeartbeatAt: true,

  //         lastStartupAt: true,

  //         lastTransactionAt: true,

  //         status: true,
  //       },
  //     });

  //     if (!machine) {
  //       return null;
  //     }

  //     const firstReceipt = await this.db.receipt.findFirst({
  //       where: {
  //         machineId: machine.id,
  //       },

  //       orderBy: {
  //         transactionAt: "asc",
  //       },

  //       select: {
  //         transactionAt: true,
  //       },
  //     });

  //     return {
  //       machineStartedAt: machine.lastStartupAt,

  //       firstReceiptCapturedAt: firstReceipt?.transactionAt ?? null,

  //       lastReceiptCapturedAt: machine.lastTransactionAt,

  //       watcherVersion: machine.watcherVersion,

  //       lastHeartbeatAt: machine.lastHeartbeatAt,

  //       status: machine.status,
  //     };
  //   }

  async getMachineSummary(agentId: string, from?: Date, to?: Date) {
    const machine = await this.db.machine.findFirst({
      where: {
        agentId,
        isDeleted: false,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        machineCode: true,
        watcherVersion: true,
        lastHeartbeatAt: true,
        lastStartupAt: true,
        lastTransactionAt: true,
        status: true,
      },
    });

    if (!machine) {
      return null;
    }

    const range = from && to ? { start: from, end: to } : getTodayRange();

    const receiptWhere = {
      machineId: machine.id,
      transactionAt: {
        gte: range.start,
        lte: range.end,
      },
    };

    const [firstReceipt, lastReceipt] = await Promise.all([
      this.db.receipt.findFirst({
        where: receiptWhere,
        orderBy: {
          transactionAt: "asc",
        },
        select: {
          transactionAt: true,
        },
      }),

      this.db.receipt.findFirst({
        where: receiptWhere,
        orderBy: {
          transactionAt: "desc",
        },
        select: {
          transactionAt: true,
        },
      }),
    ]);

    return {
      machineCode: machine.machineCode,

      machineStartedAt: machine.lastStartupAt,

      firstReceiptCapturedAt: firstReceipt?.transactionAt ?? null,

      lastReceiptCapturedAt: lastReceipt?.transactionAt ?? null,

      watcherVersion: machine.watcherVersion,

      lastHeartbeatAt: machine.lastHeartbeatAt,

      status: machine.status,
    };
  }
}
