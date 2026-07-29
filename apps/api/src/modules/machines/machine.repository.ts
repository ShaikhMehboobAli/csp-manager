import { PrismaDb } from "../../core/database/prisma.types";
import {
  ActivationStatus,
  AgentStatus,
  MachineStatus,
} from "../../generated/prisma/enums";
import { CreateMachineInput } from "./types/repository.types";

export default class MachineRepository {
  constructor(private readonly db: PrismaDb) {}

  findAgentByAgentId(agentId: string) {
    return this.db.agent.findUnique({
      where: {
        agentId,
      },
    });
  }

  findActivationByCode(activationCode: string) {
    return this.db.activation.findUnique({
      where: {
        activationCode,
      },
      include: {
        subscription: true,
      },
    });
  }

  findMachineByFingerprint(fingerprint: string) {
    return this.db.machine.findUnique({
      where: {
        fingerprint,
      },
    });
  }

  createMachine(data: CreateMachineInput) {
    return this.db.machine.create({
      data: {
        machineCode: data.machineCode,
        fingerprint: data.fingerprint,
        machineName: data.machineName,
        watcherVersion: data.watcherVersion,
        osName: data.osName,
        osVersion: data.osVersion,
        deviceName: data.deviceName,
        ipAddress: data.ipAddress,

        currentAgentId: data.currentAgentId,
        agentId: data.agentId,

        status: MachineStatus.ACTIVE,
        isOnline: true,
        lastStartupAt: new Date(),

        apiKeyHash: data.apiKeyHash,
        apiKeyIssuedAt: data.apiKeyIssuedAt,
        apiKeyExpiresAt: data.apiKeyExpiresAt,
      },
    });
  }

  activateActivation(activationId: string, machineId: string, agentId: string) {
    return this.db.activation.update({
      where: {
        id: activationId,
      },
      data: {
        machineId,
        assignedAgentId: agentId,
        activatedAt: new Date(),
        status: ActivationStatus.ACTIVE,
      },
    });
  }

  findActivationById(id: string) {
    return this.db.activation.findUnique({
      where: {
        id,
      },
      include: {
        subscription: true,
      },
    });
  }

  findAgent(agentId: string) {
    return this.db.agent.findUnique({
      where: {
        agentId,
      },
    });
  }

  assignActivation(
    activationId: string,
    assignedAgentId: string,
    assignedBy: string,
  ) {
    return this.db.activation.update({
      where: {
        id: activationId,
      },
      data: {
        assignedAgentId,
        assignedAt: new Date(),
        assignedBy,
      },
    });
  }

  countActiveMachines(subscriptionId: string) {
    return this.db.activation.count({
      where: {
        subscriptionId,
        status: ActivationStatus.ACTIVE,
        machineId: {
          not: null,
        },
      },
    });
  }

  activateMachine(activationId: string, machineId: string, agentId: string) {
    return this.db.activation.update({
      where: {
        id: activationId,
      },
      data: {
        machineId,
        activatedAt: new Date(),
        activatedBy: agentId,
        status: ActivationStatus.ACTIVE,
        isCurrent: false,
      },
    });
  }
}
