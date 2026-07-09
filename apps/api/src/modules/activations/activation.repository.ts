import { PrismaDb } from "../../core/database/prisma.types";
import { ActivationStatus } from "../../generated/prisma/enums";

import bcrypt from "bcrypt";

export default class ActivationRepository {
  constructor(private readonly db: PrismaDb) {}

  createActivation(data: {
    activationCode: string;
    activationPasswordHash: string;
    subscriptionId: string;
    expiresAt: Date;
  }) {
    return this.db.activation.create({
      data: {
        activationCode: data.activationCode,
        activationPasswordHash: data.activationPasswordHash,
        subscriptionId: data.subscriptionId,
        expiresAt: data.expiresAt,
        status: ActivationStatus.NOT_ACTIVATED,
      },
    });
  }

  findByAgent(agentId: string) {
    return this.db.activation.findMany({
      where: {
        subscription: {
          agentId,
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

  countSubscriptionActivations(subscriptionId: string) {
    return this.db.activation.count({
      where: {
        subscriptionId,
      },
    });
  }

  findActivationsByAgent(agentId: string) {
    return this.db.activation.findMany({
      where: {
        subscription: {
          agentId,
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
            ownerId: true,
            ownerType: true,
            agentId: true,
          },
        },
      },
    });
  }
}
