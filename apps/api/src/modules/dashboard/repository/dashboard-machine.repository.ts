import { PrismaDb } from "../../../core/database/prisma.types";
import { getDashboardDateRange } from "../../../core/utils/dashboard-date-range";
import { normalizeDateRange } from "../../../core/utils/date-range.helper";
import { Prisma } from "../../../generated/prisma/client";
import { calculateSessionOverlapSeconds } from "../../machines/runtime/machine-runtime.helper";
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

    const { from, to } = normalizeDateRange(range?.start, range?.end);

    const receiptWhere = {
      machineId: machine.id,
      transactionAt: {
        gte: from,
        lte: to,
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
    /**
     * Runtime date range:
     *
     * No filter:
     *   today 00:00 -> today 23:59:59.999
     *
     * With filter:
     *   selected from -> selected to
     */
    const { from: runtimeFrom, to: runtimeTo } = getDashboardDateRange(
      filter.from,
      filter.to,
    );

    // ============================================================
    // 1. GET MACHINES
    // ============================================================

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

    // ============================================================
    // 2. GET MACHINE IDs
    // ============================================================

    const machineIds = machines.map((machine) => machine.id);

    // ============================================================
    // 3. GET MACHINE SESSIONS
    //
    // We fetch sessions which overlap the requested
    // runtime date range.
    //
    // Example:
    //
    // Session:
    // July 31 23:00 -> Aug 1 06:00
    //
    // Filter:
    // Aug 1 -> Aug 10
    //
    // This session is included because it overlaps
    // the requested period.
    // ============================================================

    const sessions =
      machineIds.length === 0
        ? []
        : await this.db.machineSession.findMany({
            where: {
              machineId: {
                in: machineIds,
              },

              startedAt: {
                lte: runtimeTo,
              },

              OR: [
                {
                  endedAt: null,
                },
                {
                  endedAt: {
                    gte: runtimeFrom,
                  },
                },
              ],
            },

            select: {
              id: true,

              machineId: true,

              startedAt: true,

              endedAt: true,

              durationSeconds: true,

              status: true,

              isUnexpectedStop: true,
            },
          });

    // ============================================================
    // 4. GROUP SESSIONS BY MACHINE
    // ============================================================

    const sessionMap = new Map<string, typeof sessions>();

    for (const session of sessions) {
      const existing = sessionMap.get(session.machineId) ?? [];

      existing.push(session);

      sessionMap.set(session.machineId, existing);
    }

    // ============================================================
    // DEBUG
    // ============================================================

    console.log(
      "machine agentIds",
      machines.map((m) => ({
        machineId: m.id,

        machineAgentId: m.agentId,

        agentCode: m.agent?.agentId,
      })),
    );

    console.log("runtime range", {
      from: runtimeFrom.toISOString(),

      to: runtimeTo.toISOString(),
    });

    console.log(
      "machine sessions",
      sessions.map((session) => ({
        machineId: session.machineId,

        startedAt: session.startedAt,

        endedAt: session.endedAt,

        status: session.status,
      })),
    );

    // ============================================================
    // 5. RECEIPT / TRANSACTION SUMMARY
    // ============================================================

    // const receiptWhere: Prisma.ReceiptWhereInput = {
    //   agentId: {
    //     in: machines
    //       .map((m) => m.agentId)
    //       .filter((id): id is string => Boolean(id)),
    //   },
    // };

    const receiptWhere: Prisma.ReceiptWhereInput = {
      agentId: {
        in: machines
          .map((m) => m.agentId)
          .filter((id): id is string => Boolean(id)),
      },

      transactionAt: {
        gte: runtimeFrom,

        lte: runtimeTo,
      },
    };

    // if (filter.from || filter.to) {
    //   receiptWhere.transactionAt = {
    //     ...(filter.from && {
    //       gte: runtimeFrom,
    //     }),

    //     ...(filter.to && {
    //       lte: runtimeTo,
    //     }),
    //   };
    // }

    const transactionSummary = await this.db.receipt.groupBy({
      by: ["agentId", "status"],

      where: receiptWhere,

      _count: {
        id: true,
      },

      _sum: {
        amount: true,
      },
    });

    console.log("transactionSummary");

    console.dir(transactionSummary, {
      depth: null,
    });

    console.log("Dashboard Receipt Filter:");
    console.dir(receiptWhere, { depth: null });

    console.log("Dashboard Runtime Range:", {
      from: runtimeFrom.toISOString(),
      to: runtimeTo.toISOString(),
    });

    // ============================================================
    // 6. CREATE TRANSACTION MAP
    // ============================================================

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

    // ============================================================
    // 7. BUILD MACHINE MONITORING
    // ============================================================

    const monitoring = machines.map((machine) => {
      // --------------------------------------------------------
      // Transaction data
      // --------------------------------------------------------

      const transaction = transactionMap.get(machine.agentId!) ?? {
        count: 0,

        amount: 0,

        success: 0,

        failed: 0,
      };

      // --------------------------------------------------------
      // Machine sessions
      // --------------------------------------------------------

      const machineSessions = sessionMap.get(machine.id) ?? [];

      // --------------------------------------------------------
      // Calculate total online seconds
      //
      // Handles:
      // - multiple sessions
      // - sessions spanning midnight
      // - sessions spanning date range
      // - active session
      // --------------------------------------------------------

      const totalRuntimeSeconds = machineSessions.reduce(
        (total, session) =>
          total +
          calculateSessionOverlapSeconds(session, runtimeFrom, runtimeTo),
        0,
      );

      // --------------------------------------------------------
      // Total online hours
      // --------------------------------------------------------

      const onlineHours = Number((totalRuntimeSeconds / 3600).toFixed(2));

      // --------------------------------------------------------
      // Number of days in selected range
      //
      // Aug 1 -> Aug 1 = 1 day
      // Aug 1 -> Aug 10 = 10 days
      // --------------------------------------------------------

      const millisecondsPerDay = 24 * 60 * 60 * 1000;

      const numberOfDays =
        Math.floor(
          (runtimeTo.getTime() - runtimeFrom.getTime()) / millisecondsPerDay,
        ) + 1;

      // --------------------------------------------------------
      // Average online hours per day
      // --------------------------------------------------------

      const averageOnlineHours =
        numberOfDays <= 0 ? 0 : Number((onlineHours / numberOfDays).toFixed(2));

      // --------------------------------------------------------
      // Session count
      // --------------------------------------------------------

      const sessionCount = machineSessions.length;

      // --------------------------------------------------------
      // Unexpected stops
      // --------------------------------------------------------

      const unexpectedStops = machineSessions.filter(
        (session) => session.isUnexpectedStop,
      ).length;

      // --------------------------------------------------------
      // Return existing machine monitoring
      // fields + runtime information
      // --------------------------------------------------------

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

        // ------------------------------------------------------
        // Existing transaction information
        // ------------------------------------------------------

        transactionCount: transaction.count,

        transactionAmount: transaction.amount,

        successTransactions: transaction.success,

        failedTransactions: transaction.failed,

        // ------------------------------------------------------
        // Runtime information
        // ------------------------------------------------------

        onlineHours,

        averageOnlineHours,

        sessionCount,

        unexpectedStops,
      };
    });

    // ============================================================
    // 8. MACHINE SUMMARY
    // ============================================================

    const totalMachines = monitoring.length;

    const onlineMachines = monitoring.filter(
      (machine) => machine.connectionStatus === "ONLINE",
    ).length;

    const offlineMachines = totalMachines - onlineMachines;

    const activeMachines = monitoring.filter(
      (machine) => machine.machineStatus === "ACTIVE",
    ).length;

    const inactiveMachines = totalMachines - activeMachines;

    // ============================================================
    // 9. FINAL RESPONSE
    // ============================================================

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
