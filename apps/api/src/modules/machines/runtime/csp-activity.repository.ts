import { PrismaDb } from "../../../core/database/prisma.types";
import {
  ActivityEndReason,
  MachineSessionStatus,
} from "../../../generated/prisma/enums";

export default class CspActivityRepository {
  constructor(private readonly db: PrismaDb) {}

  async findActiveSession(machineId: string) {
    return this.db.cspActivitySession.findFirst({
      where: {
        machineId,
        status: MachineSessionStatus.ACTIVE,
      },
      orderBy: {
        startedAt: "desc",
      },
    });
  }

  async findByActivitySessionId(machineId: string, activitySessionId: string) {
    return this.db.cspActivitySession.findFirst({
      where: {
        machineId,
        activitySessionId,
      },
    });
  }

  async createSession(data: {
    activitySessionId: string;
    machineId: string;
    agentId: string;
  }) {
    const now = new Date();

    return this.db.cspActivitySession.create({
      data: {
        ...data,
        startedAt: now,
        lastHeartbeatAt: now,
      },
    });
  }

  async updateHeartbeat(id: string) {
    return this.db.cspActivitySession.update({
      where: {
        id,
      },
      data: {
        lastHeartbeatAt: new Date(),
      },
    });
  }

  async closeSession(
    session: { id: string; startedAt: Date },
    endedAt: Date,
    reason: ActivityEndReason,
  ) {
    return this.db.cspActivitySession.update({
      where: {
        id: session.id,
      },
      data: {
        status: MachineSessionStatus.CLOSED,
        endedAt,
        endedReason: reason,
        durationSeconds: Math.max(
          0,
          Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000),
        ),
      },
    });
  }

  async findTimedOutSessions(timeoutDate: Date) {
    return this.db.cspActivitySession.findMany({
      where: {
        status: MachineSessionStatus.ACTIVE,
        lastHeartbeatAt: {
          lt: timeoutDate,
        },
      },
    });
  }

  /**
   * Sessions overlapping [from, to] for a machine, newest first.
   */
  async findSessionsForRange(machineId: string, from: Date, to: Date) {
    return this.db.cspActivitySession.findMany({
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
      orderBy: {
        startedAt: "desc",
      },
    });
  }
}
