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

  async findSessionsForRange(machineId: string, from: Date, to: Date) {
    return this.db.machineSession.findMany({
      where: {
        machineId,

        startedAt: {
          lte: to,
        },

        OR: [
          {
            endedAt: null,
          },
          {
            endedAt: {
              gte: from,
            },
          },
        ],
      },

      select: {
        id: true,
        machineSessionId: true,
        startedAt: true,
        endedAt: true,
        durationSeconds: true,
        status: true,
      },

      orderBy: {
        startedAt: "asc",
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

  async closeSession(
    sessionId: string,
    endedAt: Date,
    reason: SessionEndReason,
    isUnexpectedStop = true,
  ) {
    const session = await this.db.machineSession.findUnique({
      where: {
        id: sessionId,
      },

      select: {
        startedAt: true,
      },
    });

    if (!session) {
      return null;
    }

    const durationSeconds = this.calculateDurationSeconds(
      session.startedAt,
      endedAt,
    );

    console.log("Duration:", durationSeconds);

    const updated = await this.db.machineSession.update({
      where: {
        id: sessionId,
      },

      data: {
        status: MachineSessionStatus.CLOSED,

        endedAt,

        durationSeconds,

        isUnexpectedStop,

        endedReason: reason,
      },
    });

    console.log(updated);

    return updated;
  }

  private calculateDurationSeconds(startedAt: Date, endedAt: Date) {
    return Math.max(
      0,
      Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
    );
  }

  async deleteExpiredSessions(date: Date) {
    return this.db.machineSession.deleteMany({
      where: {
        startedAt: {
          lt: date,
        },
      },
    });
  }

  async countExpiredSessions(date: Date) {
    return this.db.machineSession.count({
      where: {
        startedAt: {
          lt: date,
        },
      },
    });
  }

  async countExpiredActiveSessions(date: Date) {
    return this.db.machineSession.count({
      where: {
        status: MachineSessionStatus.ACTIVE,
        startedAt: {
          lt: date,
        },
      },
    });
  }
}
