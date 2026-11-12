import { PrismaDb } from "../../core/database/prisma.types";
import {
  ActivationRevokeRequestStatus,
  SubscriptionOwnerType,
} from "../../generated/prisma/enums";
import { Prisma } from "../../generated/prisma/client";

const requestInclude = {
  activation: {
    select: {
      id: true,
      activationCode: true,
      status: true,
      expiresAt: true,
      assignedAgentId: true,
      machine: {
        select: {
          machineCode: true,
          machineName: true,
        },
      },
    },
  },
} satisfies Prisma.ActivationRevokeRequestInclude;

export type ActivationRevokeRequestWithRelations =
  Prisma.ActivationRevokeRequestGetPayload<{ include: typeof requestInclude }>;

export default class ActivationRevokeRepository {
  constructor(private readonly db: PrismaDb) {}

  // Row lock on the activation until the transaction ends, so two requests
  // for the same activation can't both be raised or approved.
  async lockActivation(activationId: string) {
    await this.db
      .$queryRaw`SELECT "id" FROM "Activation" WHERE "id" = ${activationId} FOR UPDATE`;
  }

  findPendingForActivation(activationId: string) {
    return this.db.activationRevokeRequest.findFirst({
      where: {
        activationId,
        status: ActivationRevokeRequestStatus.PENDING,
      },
    });
  }

  create(data: {
    requestNumber: string;
    activationId: string;
    ownerType: SubscriptionOwnerType;
    ownerId: string;
    machineCode: string | null;
    reason?: string;
    createdByUserId: string;
  }) {
    return this.db.activationRevokeRequest.create({
      data,
      include: requestInclude,
    });
  }

  findById(requestId: string) {
    return this.db.activationRevokeRequest.findUnique({
      where: {
        id: requestId,
      },
      include: requestInclude,
    });
  }

  async list(params: {
    ownerId?: string;
    status?: ActivationRevokeRequestStatus;
    activationId?: string;
    page: number;
    limit: number;
  }) {
    const where: Prisma.ActivationRevokeRequestWhereInput = {
      ...(params.ownerId && { ownerId: params.ownerId }),
      ...(params.status && { status: params.status }),
      ...(params.activationId && { activationId: params.activationId }),
    };

    const [items, total] = await Promise.all([
      this.db.activationRevokeRequest.findMany({
        where,
        include: requestInclude,
        orderBy: {
          createdAt: "desc",
        },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.db.activationRevokeRequest.count({ where }),
    ]);

    return { items, total };
  }

  update(requestId: string, data: Prisma.ActivationRevokeRequestUpdateInput) {
    return this.db.activationRevokeRequest.update({
      where: {
        id: requestId,
      },
      data,
      include: requestInclude,
    });
  }

  // A direct super admin revoke settles any pending owner request.
  closePendingForActivation(activationId: string, reviewedByUserId: string) {
    return this.db.activationRevokeRequest.updateMany({
      where: {
        activationId,
        status: ActivationRevokeRequestStatus.PENDING,
      },
      data: {
        status: ActivationRevokeRequestStatus.APPROVED,
        reviewRemarks: "Revoked directly by the super admin.",
        reviewedByUserId,
        reviewedAt: new Date(),
      },
    });
  }
}
