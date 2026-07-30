import { PrismaDb } from "../../core/database/prisma.types";
import { ActivationStatus, Prisma } from "../../generated/prisma/client";

export default class MachineRepository {
  constructor(private readonly db: PrismaDb) {}

  findAgentByAgentId(agentId: string) {
    return this.db.agent.findUnique({
      where: {
        agentId,
      },
    });
  }

  findActivation(activationCode: string) {
    return this.db.activation.findUnique({
      where: {
        activationCode,
      },
      include: {
        subscription: true,
      },
    });
  }

  findParentAgent(agentId: string) {
    return this.db.agent.findUnique({
      where: {
        agentId,
      },
      select: {
        parentAgentId: true,
      },
    });
  }

  findAgentHierarchy(agentId: string) {
    return this.db.agent.findUnique({
      where: {
        agentId,
      },
      select: {
        agentId: true,
        type: true,
        bcId: true,
        parentAgentId: true,
      },
    });
  }

  findMachineByFingerprint(fingerprint: string) {
    return this.db.machine.findUnique({
      where: {
        fingerprint,
      },
      include: {
        activations: {
          where: {
            isCurrent: true,
          },
          include: {
            subscription: true,
          },
        },
      },
    });
  }

  createMachine(data: Prisma.MachineCreateInput) {
    return this.db.machine.create({
      data,
    });
  }

  completeActivation(activationId: string, machineId: string) {
    return this.db.activation.update({
      where: {
        id: activationId,
      },
      data: {
        machineId,
        status: ActivationStatus.ACTIVE,
        activatedAt: new Date(),
        isCurrent: true,
      },
    });
  }

  createMachineSession(data: Prisma.MachineSessionCreateInput) {
    return this.db.machineSession.create({
      data,
    });
  }
}
