import { PrismaDb } from "../../core/database/prisma.types";
import {
  AgentStatus,
  AgentType,
  BcLinkRequestStatus,
} from "../../generated/prisma/enums";
import { Prisma } from "../../generated/prisma/client";

import { ListLinkRequestsQuery } from "./bc-link.validation";

const SEARCH_LIMIT = 20;

const requestInclude = {
  businessCorrespondent: {
    select: {
      bcId: true,
      name: true,
    },
  },
  csp: {
    select: {
      agentId: true,
      name: true,
      bcId: true,
    },
  },
} satisfies Prisma.BcLinkRequestInclude;

export type BcLinkRequestWithRelations = Prisma.BcLinkRequestGetPayload<{
  include: typeof requestInclude;
}>;

export default class BcLinkRepository {
  constructor(private readonly db: PrismaDb) {}

  searchCsps(search: string) {
    return this.db.agent.findMany({
      where: {
        type: AgentType.CSP,
        status: AgentStatus.ACTIVE,
        isDeleted: false,
        OR: [
          {
            agentId: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
        ],
      },
      select: {
        agentId: true,
        name: true,
        address: true,
        bcId: true,
      },
      orderBy: {
        agentId: "asc",
      },
      take: SEARCH_LIMIT,
    });
  }

  findCsp(agentId: string) {
    return this.db.agent.findFirst({
      where: {
        agentId,
        type: AgentType.CSP,
        status: AgentStatus.ACTIVE,
        isDeleted: false,
      },
      select: {
        agentId: true,
        name: true,
        bcId: true,
      },
    });
  }

  findPendingCspIds(bcId: string, cspAgentIds: string[]) {
    return this.db.bcLinkRequest.findMany({
      where: {
        bcId,
        cspAgentId: {
          in: cspAgentIds,
        },
        status: BcLinkRequestStatus.PENDING,
      },
      select: {
        cspAgentId: true,
      },
    });
  }

  findPendingRequest(bcId: string, cspAgentId: string) {
    return this.db.bcLinkRequest.findFirst({
      where: {
        bcId,
        cspAgentId,
        status: BcLinkRequestStatus.PENDING,
      },
      select: {
        id: true,
      },
    });
  }

  createRequest(data: {
    requestNumber: string;
    bcId: string;
    cspAgentId: string;
    isConflict: boolean;
    currentBcId: string | null;
    cspSubscriptionRequired: boolean;
    remarks?: string;
    createdByUserId: string;
  }) {
    return this.db.bcLinkRequest.create({
      data,
      include: requestInclude,
    });
  }

  findById(id: string) {
    return this.db.bcLinkRequest.findUnique({
      where: {
        id,
      },
      include: requestInclude,
    });
  }

  async list(filter: ListLinkRequestsQuery) {
    const where: Prisma.BcLinkRequestWhereInput = {
      ...(filter.status && { status: filter.status }),
      ...(filter.isConflict !== undefined && {
        isConflict: filter.isConflict,
      }),
      ...(filter.bcId && { bcId: filter.bcId }),
      ...(filter.cspAgentId && { cspAgentId: filter.cspAgentId }),
    };

    const [items, total] = await Promise.all([
      this.db.bcLinkRequest.findMany({
        where,
        include: requestInclude,
        orderBy: {
          createdAt: "desc",
        },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),

      this.db.bcLinkRequest.count({ where }),
    ]);

    return { items, total };
  }

  updateRequest(id: string, data: Prisma.BcLinkRequestUpdateInput) {
    return this.db.bcLinkRequest.update({
      where: {
        id,
      },
      data,
      include: requestInclude,
    });
  }

  /**
   * Links the CSP and its KOs to the BC. The CSP keeps working on its own
   * subscription; the BC only gains visibility.
   */
  async linkCsp(
    cspAgentId: string,
    bcId: string,
    requiresCspSubscription: boolean,
  ) {
    const linkedAt = new Date();

    await this.db.agent.update({
      where: {
        agentId: cspAgentId,
      },
      data: {
        bcId,
        linkedAt,
        bcLinkedByRequest: requiresCspSubscription,
      },
    });

    await this.db.agent.updateMany({
      where: {
        parentAgentId: cspAgentId,
        type: AgentType.KO,
      },
      data: {
        bcId,
        linkedAt,
      },
    });
  }

  // Other BCs still waiting on this CSP now conflict with the new link.
  flagPendingAsConflict(cspAgentId: string, exceptId: string, bcId: string) {
    return this.db.bcLinkRequest.updateMany({
      where: {
        cspAgentId,
        status: BcLinkRequestStatus.PENDING,
        id: {
          not: exceptId,
        },
      },
      data: {
        isConflict: true,
        currentBcId: bcId,
      },
    });
  }
}
