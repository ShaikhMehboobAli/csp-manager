// import {
//   Agent,
//   AgentType,
//   Prisma,
//   PrismaClient,
// } from "../../../generated/prisma/client";
// import {
//   CreateAgentRepositoryInput,
//   FindAgentByAgentIdRepositoryInput,
//   LinkAgentToBCRepositoryInput,
// } from "../types/repository.types";

// export class AgentRepository {
//   constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}

//   async findAgentByAgentId(
//     input: FindAgentByAgentIdRepositoryInput,
//   ): Promise<Agent | null> {
//     return this.db.agent.findFirst({
//       where: {
//         agentId: input.agentId,
//         isDeleted: false,
//       },
//     });
//   }

//   async createAgent(input: CreateAgentRepositoryInput): Promise<Agent> {
//     return this.db.agent.create({
//       data: {
//         agentId: input.agentId,
//         name: input.name,
//         type: input.type,

//         mobile: input.mobile,
//         email: input.email,
//         address: input.address,

//         cashLimit: input.cashLimit,
//         openingCash: input.openingCash,

//         bcId: input.bcId,
//         parentAgentId: input.parentAgentId,

//         selfRegistered: input.selfRegistered ?? false,
//         isProfileCompleted: input.isProfileCompleted ?? false,

//         linkedAt: input.linkedAt,

//         createdByAgentId: input.createdByAgentId,
//         createdBy: input.createdBy,
//       },
//     });
//   }

//   async linkCSPToBC(input: LinkAgentToBCRepositoryInput): Promise<Agent> {
//     return this.db.agent.update({
//       where: {
//         agentId: input.agentId,
//       },
//       data: {
//         bcId: input.bcId,

//         cashLimit: input.cashLimit,
//         openingCash: input.openingCash,

//         linkedAt: input.linkedAt,

//         updatedBy: input.updatedBy,
//       },
//     });
//   }

//   async countLinkedCSPs(bcId: string): Promise<number> {
//     return this.db.agent.count({
//       where: {
//         bcId,
//         type: AgentType.CSP,
//         isDeleted: false,
//       },
//     });
//   }

//   async countLinkedKOs(bcId: string): Promise<number> {
//     return this.db.agent.count({
//       where: {
//         bcId,
//         type: AgentType.KO,
//         isDeleted: false,
//       },
//     });
//   }

//   async findLinkedCSP(bcId: string, agentId: string): Promise<Agent | null> {
//     return this.db.agent.findFirst({
//       where: {
//         bcId,
//         agentId,
//         type: AgentType.CSP,
//         isDeleted: false,
//       },
//     });
//   }

//   async findLinkedKO(bcId: string, agentId: string): Promise<Agent | null> {
//     return this.db.agent.findFirst({
//       where: {
//         bcId,
//         agentId,
//         type: AgentType.KO,
//         isDeleted: false,
//       },
//     });
//   }

//   async exists(agentId: string): Promise<boolean> {
//     const count = await this.db.agent.count({
//       where: {
//         agentId,
//         isDeleted: false,
//       },
//     });

//     return count > 0;
//   }
// }

import {
  Agent,
  AgentStatus,
  AgentType,
  Prisma,
  PrismaClient,
} from "../../../generated/prisma/client";
import {
  CreateAgentRepositoryInput,
  FindAgentByAgentIdRepositoryInput,
  LinkAgentToBCRepositoryInput,
  LinkKOToCSPRepositoryInput,
} from "../types/repository.types";

export class AgentRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}

  async findAgentByAgentId(
    input: FindAgentByAgentIdRepositoryInput,
  ): Promise<Agent | null> {
    return this.db.agent.findFirst({
      where: {
        agentId: input.agentId,
        isDeleted: false,
      },
    });
  }

  async createAgent(input: CreateAgentRepositoryInput): Promise<Agent> {
    return this.db.agent.create({
      data: {
        agentId: input.agentId,
        name: input.name,
        type: input.type,

        mobile: input.mobile,
        email: input.email,
        address: input.address,

        cashLimit: input.cashLimit,
        openingCash: input.openingCash,

        bcId: input.bcId,
        parentAgentId: input.parentAgentId,

        selfRegistered: input.selfRegistered ?? false,
        isProfileCompleted: input.isProfileCompleted ?? false,

        linkedAt: input.linkedAt,

        createdByAgentId: input.createdByAgentId,
        createdBy: input.createdBy,
      },
    });
  }

  async linkAgentToBC(input: LinkAgentToBCRepositoryInput): Promise<Agent> {
    return this.db.agent.update({
      where: {
        agentId: input.agentId,
      },
      data: {
        bcId: input.bcId,

        cashLimit: input.cashLimit,
        openingCash: input.openingCash,

        linkedAt: input.linkedAt,

        updatedBy: input.updatedBy,
      },
    });
  }

  async countBCLinkedCSPs(bcId: string): Promise<number> {
    return this.db.agent.count({
      where: {
        bcId,
        type: AgentType.CSP,
        isDeleted: false,
      },
    });
  }

  async countBCLinkedKOs(bcId: string): Promise<number> {
    return this.db.agent.count({
      where: {
        bcId,
        type: AgentType.KO,
        isDeleted: false,
      },
    });
  }

  async linkKOToCSP(input: LinkKOToCSPRepositoryInput) {
    return this.db.agent.update({
      where: {
        agentId: input.agentId,
      },
      data: {
        bcId: input.bcId,
        parentAgentId: input.parentAgentId,

        linkedAt: input.linkedAt,

        cashLimit: input.cashLimit,
        openingCash: input.openingCash,

        updatedBy: input.updatedBy,
      },
    });
  }

  async findCSPByAgentId(agentId: string) {
    return this.db.agent.findFirst({
      where: {
        agentId,
        type: AgentType.CSP,
      },
    });
  }

  async findByAgentId(agentId: string) {
    return this.db.agent.findUnique({
      where: {
        agentId,
      },
    });
  }

  async findMany(params: {
    type?: AgentType;
    bcId?: string;
    parentAgentId?: string;
    agentIds?: string[];
    skip: number;
    take: number;
  }) {
    return this.db.agent.findMany({
      where: {
        isDeleted: false,
        ...(params.agentIds?.length && {
          agentId: {
            in: params.agentIds,
          },
        }),
        ...(params.type && {
          type: params.type,
        }),

        ...(params.bcId && {
          bcId: params.bcId,
        }),

        ...(params.parentAgentId && {
          parentAgentId: params.parentAgentId,
        }),
      },
      skip: params.skip,

      take: params.take,

      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async count(params: {
    type?: AgentType;
    bcId?: string;
    parentAgentId?: string;
    agentIds?: string[];
  }) {
    return this.db.agent.count({
      where: {
        isDeleted: false,
        ...(params.agentIds?.length && {
          agentId: {
            in: params.agentIds,
          },
        }),
        ...(params.type && { type: params.type }),
        ...(params.bcId && { bcId: params.bcId }),
        ...(params.parentAgentId && {
          parentAgentId: params.parentAgentId,
        }),
      },
    });
  }

  async updateAgent(agentId: string, data: Prisma.AgentUpdateInput) {
    return this.db.agent.update({
      where: {
        agentId,
      },
      data,
    });
  }

  async softDeleteAgent(agentId: string, deletedBy: string) {
    return this.db.agent.update({
      where: {
        agentId,
      },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedByUserId: deletedBy,
        updatedBy: deletedBy,
      },
    });
  }

  async countChildren(parentAgentId: string) {
    return this.db.agent.count({
      where: {
        parentAgentId,
        isDeleted: false,
      },
    });
  }

  /**
   * Returns direct child agents.
   */
  async getChildAgents(parentAgentIds: string[], type?: AgentType) {
    return this.db.agent.findMany({
      where: {
        parentAgentId: {
          in: parentAgentIds,
        },

        ...(type && {
          type,
        }),

        status: "ACTIVE",

        isDeleted: false,
      },

      select: {
        agentId: true,
      },
    });
  }

  async getCspAgents(bcId: string) {
    return this.db.agent.findMany({
      where: {
        bcId,

        type: AgentType.CSP,

        status: AgentStatus.ACTIVE,

        isDeleted: false,
      },

      select: {
        agentId: true,
      },
    });
  }

  //   async getCspAgents(bcIds: string[]) {
  //   return this.db.agent.findMany({
  //     where: {
  //       bcId: {
  //         in: bcIds,
  //       },

  //       type: AgentType.CSP,

  //       status: AgentStatus.ACTIVE,

  //       isDeleted: false,
  //     },

  //     select: {
  //       agentId: true,
  //     },
  //   });
  // }
}
