import { PrismaDb } from "../../../core/database/prisma.types";
import { Prisma } from "../../../generated/prisma/client";
import {
  buildAgentScope,
  getMachineStatus,
  getTodayRange,
} from "../dashboard.helper";
import { DashboardFilter } from "../dashboard.types";

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

  async getCspMachineSummary(filter: DashboardFilter) {
    const machine = await this.db.machine.findFirst({
      where: {
        ...buildAgentScope(filter.agentIds, filter.agentId),

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

    const range =
      filter.from && filter.to
        ? {
            start: filter.from,
            end: filter.to,
          }
        : getTodayRange();

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

  async getBcMachineSummary(filter: DashboardFilter) {
    const machines = await this.db.machine.findMany({
      where: {
        ...buildAgentScope(filter.agentIds, filter.agentId),

        isDeleted: false,
      },

      select: {
        id: true,

        status: true,

        lastHeartbeatAt: true,

        lastTransactionAt: true,
      },
    });

    const totalMachines = machines.length;

    const activeMachines = machines.filter(
      (machine) => machine.status === "ACTIVE",
    ).length;

    const inactiveMachines = totalMachines - activeMachines;

    const onlineMachines = machines.filter(
      (machine) => getMachineStatus(machine.lastHeartbeatAt) === "ONLINE",
    ).length;

    const offlineMachines = totalMachines - onlineMachines;

    const latestHeartbeatAt =
      machines
        .map((machine) => machine.lastHeartbeatAt)
        .filter((date): date is Date => date !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const latestReceiptCapturedAt =
      machines
        .map((machine) => machine.lastTransactionAt)
        .filter((date): date is Date => date !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      totalMachines,

      onlineMachines,

      offlineMachines,

      activeMachines,

      inactiveMachines,

      latestHeartbeatAt,

      latestReceiptCapturedAt,
    };
  }

  // async getMachineMonitoring(filter: DashboardFilter) {
  //   const machines = await this.db.machine.findMany({
  //     where: {
  //       ...buildAgentScope(filter.agentIds, filter.agentId),

  //       isDeleted: false,
  //     },

  //     include: {
  //       agent: {
  //         select: {
  //           agentId: true,

  //           name: true,

  //           agentFloat: {
  //             select: {
  //               openingFloat: true,

  //               currentCashInHand: true,

  //               currentCashInAccount: true,

  //               currentTotalFloat: true,

  //               updatedAt: true,

  //               lastReceiptAt: true,

  //               lastAdjustmentAt: true,
  //             },
  //           },
  //         },
  //       },
  //     },

  //     orderBy: {
  //       updatedAt: "desc",
  //     },
  //   });

  //   const today = new Date();

  //   today.setHours(0, 0, 0, 0);

  //   const transactionSummary = await this.db.receipt.groupBy({
  //     by: ["agentId", "status"],

  //     where: {
  //       agentId: {
  //         in: machines
  //           .map((m) => m.agentId)
  //           .filter((id): id is string => Boolean(id)),
  //       },

  //       transactionAt: {
  //         gte: today,
  //       },
  //     },

  //     _count: {
  //       id: true,
  //     },

  //     _sum: {
  //       amount: true,
  //     },
  //   });

  //   const transactionMap = new Map<
  //     string,
  //     {
  //       count: number;

  //       amount: number;

  //       success: number;

  //       failed: number;
  //     }
  //   >();

  //   for (const row of transactionSummary) {
  //     const key = row.agentId;

  //     const existing = transactionMap.get(key) ?? {
  //       count: 0,

  //       amount: 0,

  //       success: 0,

  //       failed: 0,
  //     };

  //     existing.count += row._count.id;

  //     existing.amount += Number(row._sum.amount ?? 0);

  //     if (row.status === "SUCCESS") {
  //       existing.success += row._count.id;
  //     } else {
  //       existing.failed += row._count.id;
  //     }

  //     transactionMap.set(key, existing);
  //   }

  //   const monitoring = machines.map((machine) => ({
  //     agentId: machine.agent!.agentId,

  //     agentName: machine.agent!.name,

  //     machineCode: machine.machineCode,

  //     watcherVersion: machine.watcherVersion,

  //     machineStatus: machine.status,

  //     connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

  //     lastHeartbeatAt: machine.lastHeartbeatAt,

  //     lastReceiptCapturedAt: machine.lastTransactionAt,

  //     openingFloat: machine.agent!.agentFloat?.openingFloat ?? 0,

  //     currentCashInHand: machine.agent!.agentFloat?.currentCashInHand ?? 0,

  //     currentCashInAccount:
  //       machine.agent!.agentFloat?.currentCashInAccount ?? 0,

  //     currentTotalFloat: machine.agent!.agentFloat?.currentTotalFloat ?? 0,

  //     floatUpdatedAt: machine.agent!.agentFloat?.updatedAt ?? null,

  //     lastReceiptAt: machine.agent!.agentFloat?.lastReceiptAt ?? null,

  //     lastReceiptUpdatedAt: machine.agent!.agentFloat?.updatedAt ?? null,
  //   }));

  //   const totalMachines = monitoring.length;

  //   const onlineMachines = monitoring.filter(
  //     (m) => m.connectionStatus === "ONLINE",
  //   ).length;

  //   const offlineMachines = totalMachines - onlineMachines;

  //   const activeMachines = monitoring.filter(
  //     (m) => m.machineStatus === "ACTIVE",
  //   ).length;

  //   const inactiveMachines = totalMachines - activeMachines;

  //   return {
  //     summary: {
  //       totalMachines,

  //       onlineMachines,

  //       offlineMachines,

  //       activeMachines,

  //       inactiveMachines,

  //       onlinePercentage:
  //         totalMachines === 0
  //           ? 0
  //           : Number(((onlineMachines / totalMachines) * 100).toFixed(2)),
  //     },

  //     monitoring,
  //   };
  // }

  async getMachineMonitoring(filter: DashboardFilter) {
    const machines = await this.db.machine.findMany({
      where: {
        ...buildAgentScope(filter.agentIds, filter.agentId),

        isDeleted: false,
      },

      include: {
        agent: {
          select: {
            agentId: true,

            name: true,

            agentFloat: {
              select: {
                openingFloat: true,

                currentCashInHand: true,

                currentCashInAccount: true,

                currentTotalFloat: true,

                updatedAt: true,

                lastReceiptAt: true,

                lastAdjustmentAt: true,
              },
            },
          },
        },
      },

      orderBy: {
        updatedAt: "desc",
      },
    });

    console.log(
      "machine agentIds",
      machines.map((m) => ({
        machineId: m.id,
        machineAgentId: m.agentId,
        agentCode: m.agent?.agentId,
      })),
    );

    // const today = new Date();

    // today.setHours(0, 0, 0, 0);

    const receiptWhere: Prisma.ReceiptWhereInput = {
      agentId: {
        in: machines
          .map((m) => m.agentId)
          .filter((id): id is string => Boolean(id)),
      },
    };

    if (filter.from || filter.to) {
      receiptWhere.transactionAt = {
        ...(filter.from && {
          gte: filter.from,
        }),

        ...(filter.to && {
          lte: filter.to,
        }),
      };
    }

    const transactionSummary = await this.db.receipt.groupBy({
      by: ["agentId", "status"],

      where: receiptWhere,

      // where: {
      //   agentId: {
      //     in: machines
      //       .map((m) => m.agentId)
      //       .filter((id): id is string => Boolean(id)),
      //   },

      // transactionAt: {
      //   gte: filter.from ?? today,

      //   ...(filter.to && {
      //     lte: filter.to,
      //   }),
      // },
      // },

      _count: {
        id: true,
      },

      _sum: {
        amount: true,
      },
    });

    console.log("transactionSummary");
    console.dir(transactionSummary, { depth: null });

    const transactionMap = new Map<
      string,
      {
        count: number;

        amount: number;

        success: number;

        failed: number;
      }
    >();

    for (const row of transactionSummary) {
      const key = row.agentId;

      const existing = transactionMap.get(key) ?? {
        count: 0,

        amount: 0,

        success: 0,

        failed: 0,
      };

      existing.count += row._count.id;

      existing.amount += Number(row._sum.amount ?? 0);

      if (row.status === "SUCCESS") {
        existing.success += row._count.id;
      } else {
        existing.failed += row._count.id;
      }

      transactionMap.set(key, existing);
    }

    const monitoring = machines.map((machine) => {
      const transaction = transactionMap.get(machine.agentId!) ?? {
        count: 0,

        amount: 0,

        success: 0,

        failed: 0,
      };

      return {
        agentId: machine.agent!.agentId,

        agentName: machine.agent!.name,

        machineCode: machine.machineCode,

        watcherVersion: machine.watcherVersion,

        machineStatus: machine.status,

        connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

        lastHeartbeatAt: machine.lastHeartbeatAt,

        lastReceiptCapturedAt: machine.lastTransactionAt,

        openingFloat: machine.agent!.agentFloat?.openingFloat ?? 0,

        currentCashInHand: machine.agent!.agentFloat?.currentCashInHand ?? 0,

        currentCashInAccount:
          machine.agent!.agentFloat?.currentCashInAccount ?? 0,

        currentTotalFloat: machine.agent!.agentFloat?.currentTotalFloat ?? 0,

        lastReceiptAt: machine.agent!.agentFloat?.lastReceiptAt ?? null,

        lastReceiptUpdatedAt: machine.agent!.agentFloat?.updatedAt ?? null,

        transactionCount: transaction.count, //default current day transaction count

        transactionAmount: transaction.amount, //default current day transaction amount

        successTransactions: transaction.success,

        failedTransactions: transaction.failed,
      };
    });

    const totalMachines = monitoring.length;

    const onlineMachines = monitoring.filter(
      (m) => m.connectionStatus === "ONLINE",
    ).length;

    const offlineMachines = totalMachines - onlineMachines;

    const activeMachines = monitoring.filter(
      (m) => m.machineStatus === "ACTIVE",
    ).length;

    const inactiveMachines = totalMachines - activeMachines;

    return {
      summary: {
        totalMachines,

        onlineMachines,

        offlineMachines,

        activeMachines,

        inactiveMachines,

        onlinePercentage:
          totalMachines === 0
            ? 0
            : Number(((onlineMachines / totalMachines) * 100).toFixed(2)),
      },

      monitoring,
    };
  }
}
