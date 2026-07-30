import { PrismaDb } from "../../../core/database/prisma.types";
import {
  MachineSessionStatus,
  SessionEndReason,
} from "../../../generated/prisma/enums";

import { CreateMachineSessionInput } from "./machine-session.dto";

export default class MachineSessionRepository {
  constructor(private readonly db: PrismaDb) {}

  async findActiveSession(machineId: string) {
    return this.db.machineSession.findFirst({
      where: {
        machineId,
        status: MachineSessionStatus.ACTIVE,
      },
      orderBy: {
        startedAt: "desc",
      },
    });
  }

  async createSession(data: CreateMachineSessionInput) {
    const now = new Date();

    return this.db.machineSession.create({
      data: {
        machineSessionId: data.machineSessionId,
        machineId: data.machineId,

        startedAt: now,
        lastHeartbeatAt: now,

        firstAgentId: data.firstAgentId,
        lastAgentId: data.lastAgentId,

        status: MachineSessionStatus.ACTIVE,
      },
    });
  }

  async updateHeartbeat(sessionId: string, lastAgentId?: string | null) {
    return this.db.machineSession.update({
      where: {
        id: sessionId,
      },
      data: {
        lastHeartbeatAt: new Date(),
        lastAgentId,
      },
    });
  }

  async findTimedOutSessions(timeoutDate: Date) {
    return this.db.machineSession.findMany({
      where: {
        status: MachineSessionStatus.ACTIVE,
        lastHeartbeatAt: {
          lt: timeoutDate,
        },
      },
      include: {
        machine: true,
      },
    });
  }

  async closeSession(sessionId: string) {
    return this.db.machineSession.update({
      where: {
        id: sessionId,
      },
      data: {
        status: MachineSessionStatus.CLOSED,
        endedAt: new Date(),
        isUnexpectedStop: true,
        endedReason: SessionEndReason.HEARTBEAT_TIMEOUT,
      },
    });
  }
}
