import { PrismaDb } from "../../../../core/database/prisma.types";
import { normalizeDateRange } from "../../../../core/utils/date-range.helper";
import { Prisma } from "../../../../generated/prisma/client";
import { splitSessionAcrossDays } from "../machine-analytics.helper";
import { MachineAnalyticsFilter } from "../machine-analytics.types";

export default class MachineAnalyticsRepository {
  constructor(private readonly db: PrismaDb) {}

  private buildSessionWhere(
    filter: MachineAnalyticsFilter,
  ): Prisma.MachineSessionWhereInput {
    const { from, to } = normalizeDateRange(filter.from, filter.to);

    return {
      machineId: filter.machineId,

      machine: {
        agentId: {
          in: filter.agentIds,
        },
      },

      ...(from &&
        to && {
          AND: [
            {
              startedAt: {
                lte: to,
              },
            },
            {
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
          ],
        }),
    };
  }

  async getSummary(filter: MachineAnalyticsFilter) {
    const where = this.buildSessionWhere(filter);

    const sessions = await this.db.machineSession.findMany({
      where,

      select: {
        id: true,

        status: true,

        startedAt: true,

        endedAt: true,

        durationSeconds: true,

        endedReason: true,
      },
    });

    // const totalSessions = sessions.length;

    // const totalDurationSeconds = sessions.reduce(
    //   (sum, session) => sum + (session.durationSeconds ?? 0),
    //   0,
    // );

    // const averageDurationSeconds =
    //   totalSessions === 0
    //     ? 0
    //     : Math.round(totalDurationSeconds / totalSessions);

    const totalSessions = sessions.length;

    const activeSessions = sessions.filter(
      (session) => session.status === "ACTIVE",
    ).length;

    const closedSessions = sessions.filter(
      (session) => session.status === "CLOSED",
    ).length;

    const completedSessions = sessions.filter(
      (session) => session.durationSeconds !== null,
    );

    const totalDurationSeconds = completedSessions.reduce(
      (sum, session) => sum + session.durationSeconds!,
      0,
    );

    const averageDurationSeconds =
      completedSessions.length === 0
        ? 0
        : Math.round(totalDurationSeconds / completedSessions.length);

    const unexpectedStops = sessions.filter(
      (session) => session.endedReason === "HEARTBEAT_TIMEOUT",
    ).length;

    const normalShutdowns = sessions.filter(
      (session) => session.endedReason === "NORMAL_SHUTDOWN",
    ).length;

    // const longestSessionSeconds =
    //   sessions.length === 0
    //     ? 0
    //     : Math.max(...sessions.map((session) => session.durationSeconds ?? 0));

    // const shortestSessionSeconds =
    //   sessions.length === 0
    //     ? 0
    //     : Math.min(...sessions.map((session) => session.durationSeconds ?? 0));

    const longestSessionSeconds =
      completedSessions.length === 0
        ? 0
        : Math.max(
            ...completedSessions.map((session) => session.durationSeconds!),
          );

    const shortestSessionSeconds =
      completedSessions.length === 0
        ? 0
        : Math.min(
            ...completedSessions.map((session) => session.durationSeconds!),
          );

    return {
      totalSessions,

      activeSessions,

      closedSessions,

      completedSessions: completedSessions.length,

      totalDurationSeconds,

      averageDurationSeconds,

      longestSessionSeconds,

      shortestSessionSeconds,

      unexpectedStops,

      normalShutdowns,
    };
  }

  async getDailyOnlineHours(filter: MachineAnalyticsFilter) {
    const where = this.buildSessionWhere(filter);

    const sessions = await this.db.machineSession.findMany({
      where,

      select: {
        startedAt: true,
        endedAt: true,
        durationSeconds: true,
      },

      orderBy: {
        startedAt: "asc",
      },
    });

    const dailyMap = new Map<
      string,
      {
        date: string;
        onlineSeconds: number;
        sessionCount: number;
      }
    >();

    for (const session of sessions) {
      if (!session.endedAt) {
        continue;
      }

      const chunks = splitSessionAcrossDays(session.startedAt, session.endedAt);

      for (const chunk of chunks) {
        const existing = dailyMap.get(chunk.date) ?? {
          date: chunk.date,
          onlineSeconds: 0,
          sessionCount: 0,
        };

        existing.onlineSeconds += chunk.seconds;

        existing.sessionCount++;

        dailyMap.set(chunk.date, existing);
      }
    }

    return Array.from(dailyMap.values()).map((day) => ({
      date: day.date,

      onlineHours: Number((day.onlineSeconds / 3600).toFixed(2)),

      sessionCount: day.sessionCount,
    }));
  }

  async getSessionHistory(filter: MachineAnalyticsFilter) {
    const where = this.buildSessionWhere(filter);

    return this.db.machineSession.findMany({
      where,

      select: {
        machineSessionId: true,

        startedAt: true,

        endedAt: true,

        durationSeconds: true,

        status: true,

        endedReason: true,

        firstAgentId: true,

        lastAgentId: true,

        isUnexpectedStop: true,
      },

      orderBy: {
        startedAt: "desc",
      },
    });
  }
}
