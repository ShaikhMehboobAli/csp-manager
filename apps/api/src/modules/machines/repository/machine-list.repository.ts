import { PrismaDb } from "../../../core/database/prisma.types";
import {
  asReceiptGroups,
  buildDailyCountWhere,
} from "../../receipts/repository/receipt-daily-count.repository";
import { normalizeDateRange } from "../../../core/utils/date-range.helper";
import { Prisma } from "../../../generated/prisma/client";
import { buildAgentScope } from "../../dashboard/dashboard.helper";
import { getMachineStatus } from "../../dashboard/dashboard.helper";
import { HEARTBEAT_TIMEOUT_MS } from "../runtime/machine-runtime.constants";
import { MachineListFilter } from "../types/machine.types";

export default class MachineListRepository {
  constructor(private readonly db: PrismaDb) {}

  async getMachines(
    agentIds: string[],
    agentId?: string,
    filter?: MachineListFilter,
  ) {
    const onlineThreshold = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

    const where: Prisma.MachineWhereInput = {
      AND: [
        buildAgentScope(agentIds, filter?.agentId ?? agentId),

        {
          isDeleted: false,
        },

        ...(filter?.connectionStatus === "ONLINE"
          ? [
              {
                lastHeartbeatAt: {
                  gte: onlineThreshold,
                },
              },
            ]
          : []),

        ...(filter?.connectionStatus === "OFFLINE"
          ? [
              {
                NOT: {
                  lastHeartbeatAt: {
                    gte: onlineThreshold,
                  },
                },
              },
            ]
          : []),

        ...(filter?.machineStatus
          ? [
              {
                status: filter.machineStatus,
              },
            ]
          : []),

        ...(filter?.watcherEnabled !== undefined
          ? [
              {
                watcherEnabled: filter.watcherEnabled,
              },
            ]
          : []),

        ...(filter?.agentType
          ? [
              {
                agent: {
                  is: {
                    type: filter.agentType,
                  },
                },
              },
            ]
          : []),

        ...(filter?.search
          ? [
              {
                OR: [
                  {
                    machineCode: {
                      contains: filter.search,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    machineName: {
                      contains: filter.search,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    agentId: {
                      contains: filter.search,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    agent: {
                      is: {
                        agentId: {
                          contains: filter.search,
                          mode: "insensitive" as const,
                        },
                      },
                    },
                  },
                  {
                    agent: {
                      is: {
                        name: {
                          contains: filter.search,
                          mode: "insensitive" as const,
                        },
                      },
                    },
                  },
                  {
                    agent: {
                      is: {
                        childAgents: {
                          some: {
                            agentId: {
                              contains: filter.search,
                              mode: "insensitive" as const,
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    agent: {
                      is: {
                        childAgents: {
                          some: {
                            name: {
                              contains: filter.search,
                              mode: "insensitive" as const,
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };

    const [machines, total] = await Promise.all([
      this.db.machine.findMany({
        where,

        include: {
          agent: {
            select: {
              id: true,

              agentId: true,

              name: true,

              type: true,

              mobile: true,

              email: true,

              address: true,

              bcId: true,

              parentAgentId: true,

              linkedAt: true,

              createdAt: true,

              updatedAt: true,

              agentFloat: {
                select: {
                  openingFloat: true,

                  currentCashInHand: true,

                  currentCashInAccount: true,

                  currentTotalFloat: true,

                  lastReceiptAt: true,

                  updatedAt: true,
                },
              },

              childAgents: {
                where: {
                  isDeleted: false,
                },

                select: {
                  id: true,

                  agentId: true,

                  name: true,

                  type: true,

                  mobile: true,

                  email: true,

                  address: true,

                  bcId: true,

                  parentAgentId: true,

                  linkedAt: true,

                  createdAt: true,

                  updatedAt: true,
                },
              },
            },
          },
        },

        orderBy: {
          [filter?.sortBy ?? "updatedAt"]: filter?.sortOrder ?? "desc",
        },

        skip: ((filter?.page ?? 1) - 1) * (filter?.limit ?? 10),

        take: filter?.limit ?? 10,
      }),

      this.db.machine.count({
        where,
      }),
    ]);

    return {
      items: machines,

      pagination: {
        page: filter?.page ?? 1,

        limit: filter?.limit ?? 10,

        total,

        totalPages: Math.ceil(total / (filter?.limit ?? 10)),
      },
    };
  }

  async getMachine(machineId: string, agentIds: string[], agentId?: string) {
    return this.db.machine.findFirst({
      where: {
        id: machineId,

        ...buildAgentScope(agentIds, agentId),

        isDeleted: false,
      },

      include: {
        agent: {
          select: {
            id: true,

            agentId: true,

            name: true,

            type: true,

            mobile: true,

            email: true,

            address: true,

            bcId: true,

            parentAgentId: true,

            linkedAt: true,

            createdAt: true,

            updatedAt: true,

            agentFloat: {
              select: {
                openingFloat: true,

                currentCashInHand: true,

                currentCashInAccount: true,

                currentTotalFloat: true,

                lastReceiptAt: true,

                updatedAt: true,
              },
            },

            childAgents: {
              where: {
                isDeleted: false,
              },

              select: {
                id: true,

                agentId: true,

                name: true,

                type: true,

                mobile: true,

                email: true,

                address: true,

                bcId: true,

                parentAgentId: true,

                linkedAt: true,

                createdAt: true,

                updatedAt: true,
              },
            },
          },
        },
      },
    });
  }

  async updateMachine(
    machineId: string,
    data: {
      machineName?: string;
      watcherEnabled?: boolean;
    },
    agentIds: string[],
    agentId?: string,
  ) {
    const machine = await this.db.machine.findFirst({
      where: {
        id: machineId,

        ...buildAgentScope(agentIds, agentId),

        isDeleted: false,
      },
    });

    if (!machine) {
      return null;
    }

    return this.db.machine.update({
      where: {
        id: machineId,
      },

      data,
    });
  }

  async getHeartbeat(machineId: string, agentIds: string[], agentId?: string) {
    return this.db.machine.findFirst({
      where: {
        id: machineId,

        ...buildAgentScope(agentIds, agentId),

        isDeleted: false,
      },

      include: {
        activations: {
          where: {
            isCurrent: true,
          },

          include: {
            subscription: true,
          },

          take: 1,
        },
      },
    });
  }

  /**
   * Each PC on its own (rather than its CSP unit): the agent working on it,
   * its own status, and the transactions and services counted on that
   * machine in the range (daily counts carry the machine).
   */
  async getPcStats(
    machines: { id: string; agentId: string | null; currentAgentId: string | null; status: string; lastHeartbeatAt: Date | null; lastStartupAt: Date | null }[],
    filter?: { from?: Date; to?: Date },
  ) {
    const ids = machines.map((machine) => machine.id);

    if (ids.length === 0) {
      return new Map<string, ReturnType<typeof emptyPc>>();
    }

    const { from, to } = normalizeDateRange(filter?.from, filter?.to);
    const where = { ...buildDailyCountWhere({ from, to }), machineId: { in: ids } };
    const agentIds = [...new Set(machines.map((machine) => machine.currentAgentId ?? machine.agentId).filter((id): id is string => !!id))];

    const [byStatus, byCategory, agents] = await Promise.all([
      this.db.receiptDailyCount.groupBy({ by: ["machineId", "status"], where, _sum: { count: true, amount: true } }),
      this.db.receiptDailyCount.groupBy({ by: ["machineId", "transactionCategory"], where, _sum: { count: true } }),
      this.db.agent.findMany({ where: { agentId: { in: agentIds } }, select: { agentId: true, name: true, type: true } }),
    ]);

    const agentById = new Map(agents.map((agent) => [agent.agentId, agent]));
    const result = new Map<string, ReturnType<typeof emptyPc>>();

    for (const machine of machines) {
      const ownId = machine.currentAgentId ?? machine.agentId;

      result.set(machine.id, {
        ...emptyPc(),
        agent: ownId ? agentById.get(ownId) ?? { agentId: ownId, name: null, type: null } : null,
        machineStatus: machine.status,
        connectionStatus: getMachineStatus(machine.lastHeartbeatAt),
        lastHeartbeatAt: machine.lastHeartbeatAt,
        lastStartupAt: machine.lastStartupAt,
      });
    }

    for (const row of byStatus) {
      const pc = result.get(row.machineId)!;
      const count = row._sum.count ?? 0;

      pc.transaction.count += count;
      pc.transaction.amount += Number(row._sum.amount ?? 0);

      if (row.status === "SUCCESS") pc.transaction.success += count;
      if (row.status === "FAILED") pc.transaction.failed += count;
    }

    for (const row of byCategory) {
      result.get(row.machineId)!.services.push({
        transactionCategory: row.transactionCategory,
        count: row._sum.count ?? 0,
      });
    }

    for (const pc of result.values()) {
      pc.transaction.amount = Number(pc.transaction.amount.toFixed(2));
      pc.services.sort((a, b) => b.count - a.count);
    }

    return result;
  }

  async getTransactionSummary(agentIds: string[], filter?: MachineListFilter) {
    const { from, to } = normalizeDateRange(filter?.from, filter?.to);

    console.log("frpm---", from, "/n", to);

    const result = asReceiptGroups(
      await this.db.receiptDailyCount.groupBy({
        by: ["agentId", "status"],

        where: {
          ...buildDailyCountWhere({ from, to }),

          agentId: {
            in: agentIds,
          },
        },

        _sum: {
          count: true,
          amount: true,
        },
      }),
    );

    console.log("Transaction Summary Result", result);

    return result;
  }

  async getServiceSummary(agentIds: string[], filter?: MachineListFilter) {
    const { from, to } = normalizeDateRange(filter?.from, filter?.to);

    const result = asReceiptGroups(
      await this.db.receiptDailyCount.groupBy({
        by: ["agentId", "transactionCategory"],

        where: {
          ...buildDailyCountWhere({ from, to }),

          agentId: {
            in: agentIds,
          },
        },

        _sum: {
          count: true,
        },
      }),
    );

    console.log("Transaction service Result", result);
    return result;
  }

  async getMachineSummary(agentIds: string[]) {
    return this.db.machine.findMany({
      where: {
        agentId: {
          in: agentIds,
        },

        isDeleted: false,
      },

      select: {
        id: true,

        agentId: true,

        machineCode: true,

        machineName: true,

        status: true,

        lastHeartbeatAt: true,

        lastStartupAt: true,

        lastTransactionAt: true,
      },
    });
  }
}

function emptyPc() {
  return {
    agent: null as { agentId: string; name: string | null; type: string | null } | null,
    machineStatus: "" as string,
    connectionStatus: "OFFLINE" as string,
    lastHeartbeatAt: null as Date | null,
    lastStartupAt: null as Date | null,
    transaction: { count: 0, amount: 0, success: 0, failed: 0 },
    services: [] as { transactionCategory: string; count: number }[],
  };
}
