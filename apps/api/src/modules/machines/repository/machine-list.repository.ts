import { PrismaDb } from "../../../core/database/prisma.types";
import { normalizeDateRange } from "../../../core/utils/date-range.helper";
import { Prisma } from "../../../generated/prisma/client";
import {
  buildAgentScope,
  HEARTBEAT_TIMEOUT_MS,
} from "../../dashboard/dashboard.helper";
import { getMachineStatus } from "../../dashboard/dashboard.helper";
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

  async getTransactionSummary(agentIds: string[], filter?: MachineListFilter) {
    const { from, to } = normalizeDateRange(filter?.from, filter?.to);

    console.log("frpm---", from, "/n", to);

    const result = await this.db.receipt.groupBy({
      by: ["agentId", "status"],

      where: {
        agentId: {
          in: agentIds,
        },

        transactionAt: {
          gte: from,

          ...(to && {
            lte: to,
          }),
        },
      },

      _count: {
        id: true,
      },

      _sum: {
        amount: true,
      },
    });

    console.log("Transaction Summary Result", result);

    return result;
  }

  async getServiceSummary(agentIds: string[], filter?: MachineListFilter) {
    const { from, to } = normalizeDateRange(filter?.from, filter?.to);

    const result = await this.db.receipt.groupBy({
      by: ["agentId", "transactionCategory"],

      where: {
        agentId: {
          in: agentIds,
        },

        transactionAt: {
          gte: from,

          ...(to && {
            lte: to,
          }),
        },
      },

      _count: {
        id: true,
      },
    });

    console.log("Transaction service Result", result);
    return result;
  }

  async getMachineSummary(agentIds: string[]) {
    const today = new Date();

    today.setHours(0, 0, 0, 0);

    return this.db.machine.findMany({
      where: {
        agentId: {
          in: agentIds,
        },

        isDeleted: false,
      },

      select: {
        agentId: true,

        lastHeartbeatAt: true,

        lastTransactionAt: true,
      },
    });
  }
}
