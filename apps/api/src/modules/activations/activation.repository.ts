import { PrismaDb } from "../../core/database/prisma.types";
import {
  ActivationStatus,
  SubscriptionOwnerType,
} from "../../generated/prisma/enums";

import bcrypt from "bcrypt";
import { AssignActivationInput } from "./types/service.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { AssignActivationCodesRepositoryInput } from "./types/repository.types";
import { Prisma, PrismaClient } from "../../generated/prisma/client";

export default class ActivationRepository {
  // constructor(private readonly db: PrismaDb) {}
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}

  createActivation(data: {
    activationCode: string;
    // activationPasswordHash: string;
    subscriptionId: string;
    expiresAt: Date;
  }) {
    return this.db.activation.create({
      data: {
        activationCode: data.activationCode,
        // activationPasswordHash: data.activationPasswordHash,
        subscriptionId: data.subscriptionId,
        expiresAt: data.expiresAt,
        status: ActivationStatus.NOT_ACTIVATED,
      },
    });
  }

  findByOwner(ownerId: string) {
    return this.db.activation.findMany({
      where: {
        subscription: {
          ownerId,
        },
      },
      include: {
        subscription: {
          select: {
            subscriptionNumber: true,
            endDate: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  /**
   * Moves activated machines from one subscription to another so they keep
   * working after a renewal or upgrade without re-activation.
   * Returns the number of activations moved.
   */
  async carryOverActivations(
    fromSubscriptionId: string,
    toSubscriptionId: string,
    expiresAt: Date,
    limit: number,
  ) {
    const activations = await this.db.activation.findMany({
      where: {
        subscriptionId: fromSubscriptionId,
        status: ActivationStatus.ACTIVE,
        isCurrent: true,
        machineId: {
          not: null,
        },
      },
      orderBy: {
        activatedAt: "asc",
      },
      take: limit,
      select: {
        id: true,
      },
    });

    if (activations.length === 0) {
      return 0;
    }

    const result = await this.db.activation.updateMany({
      where: {
        id: {
          in: activations.map((activation) => activation.id),
        },
      },
      data: {
        subscriptionId: toSubscriptionId,
        expiresAt,
      },
    });

    return result.count;
  }

  revokeUnusedActivations(subscriptionId: string) {
    return this.db.activation.updateMany({
      where: {
        subscriptionId,
        status: ActivationStatus.NOT_ACTIVATED,
      },
      data: {
        status: ActivationStatus.REVOKED,
        isCurrent: false,
      },
    });
  }

  updateSubscriptionActivationExpiry(subscriptionId: string, expiresAt: Date) {
    return this.db.activation.updateMany({
      where: {
        subscriptionId,
        status: {
          in: [ActivationStatus.NOT_ACTIVATED, ActivationStatus.ACTIVE],
        },
      },
      data: {
        expiresAt,
      },
    });
  }

  countSubscriptionActivations(subscriptionId: string) {
    return this.db.activation.count({
      where: {
        subscriptionId,
      },
    });
  }

  findActivationsByOwner(ownerId: string) {
    return this.db.activation.findMany({
      where: {
        subscription: {
          ownerId,
        },
      },
      include: {
        machine: {
          select: {
            machineCode: true,
            machineName: true,
            fingerprint: true,
            status: true,
            isOnline: true,
            lastHeartbeatAt: true,
          },
        },
        subscription: {
          select: {
            subscriptionNumber: true,
            endDate: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  findActivationById(activationId: string, ownerId: string) {
    return this.db.activation.findFirst({
      where: {
        id: activationId,
        subscription: {
          ownerId,
        },
      },
      include: {
        machine: {
          select: {
            machineCode: true,
            machineName: true,
            fingerprint: true,
            status: true,
          },
        },
        subscription: {
          select: {
            subscriptionNumber: true,
            ownerId: true,
            ownerType: true,
            endDate: true,
          },
        },
      },
    });
  }

  updateActivationPassword(
    activationId: string,
    activationPasswordHash: string,
  ) {
    return this.db.activation.update({
      where: {
        id: activationId,
      },
      data: {
        activationPasswordHash,
        passwordRegeneratedAt: new Date(),
      },
    });
  }

  findActivationForOwner(activationId: string, ownerId: string) {
    return this.db.activation.findFirst({
      where: {
        id: activationId,
        subscription: {
          ownerId,
        },
      },
      include: {
        subscription: true,
      },
    });
  }

  findActivationForAssignment(activationId: string) {
    return this.db.activation.findUnique({
      where: {
        id: activationId,
      },
      include: {
        subscription: true,
      },
    });
  }

  findAgentByAgentId(agentId: string) {
    return this.db.agent.findUnique({
      where: {
        agentId,
      },
    });
  }

  assignActivation(
    data: AssignActivationInput,
    activationPasswordHash: string,
  ) {
    // return this.db.activation.update({
    //   where: {
    //     id: data.activationId,
    //   },
    //   data: {
    //     assignedAgentId: data.assignedAgentId,
    //     assignedByOwnerType: data.assignedByOwnerType,
    //     assignedByOwnerId: data.assignedByOwnerId,
    //     assignedAt: new Date(),
    //   },
    // });
    return this.db.activation.update({
      where: {
        id: data.activationId,
      },
      data: {
        assignedAgentId: data.assignedAgentId,
        assignedByOwnerType: data.assignedByOwnerType,
        assignedByOwnerId: data.assignedByOwnerId,
        assignedAt: new Date(),

        activationPasswordHash,
        passwordGeneratedAt: new Date(),
      },
    });
  }

  findAgentWithHierarchy(agentId: string) {
    return this.db.agent.findUnique({
      where: {
        agentId,
      },
      select: {
        id: true,
        agentId: true,
        type: true,
        status: true,
        bcId: true,
        parentAgentId: true,
      },
    });
  }

  async countConsumedMachineSlots(
    ownerType: SubscriptionOwnerType,
    ownerId: string,
  ): Promise<number> {
    return this.db.activation.count({
      where: {
        subscription: {
          ownerType,
          ownerId,
        },
        status: {
          in: [ActivationStatus.NOT_ACTIVATED, ActivationStatus.ACTIVE],
        },
      },
    });
  }

  async assignMachineSlots(
    input: AssignActivationCodesRepositoryInput,
  ): Promise<void> {
    const subscription = await this.db.subscription.findFirst({
      where: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        status: "ACTIVE",
        isDeleted: false,
      },
      select: {
        id: true,
      },
    });

    if (!subscription) {
      throw new BadRequestError("Active subscription not found.");
    }

    const activations = await this.db.activation.findMany({
      where: {
        subscriptionId: subscription.id,
        assignedAgentId: null,
        status: ActivationStatus.NOT_ACTIVATED,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: input.count,
      select: {
        id: true,
      },
    });

    if (activations.length < input.count) {
      throw new BadRequestError("Insufficient activation codes available.");
    }

    await this.db.activation.updateMany({
      where: {
        id: {
          in: activations.map((activation) => activation.id),
        },
      },
      data: {
        assignedAgentId: input.agentId,
        assignedByOwnerType: input.ownerType,
        assignedByOwnerId: input.ownerId,
        assignedAt: new Date(),
      },
    });
  }
}
