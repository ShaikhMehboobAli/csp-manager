import { PrismaDb } from "../../core/database/prisma.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { endOfIstDay, istDateKey, istInstant, istParts, startOfIstDay } from "../../core/utils/ist";
import { AgentType } from "../../generated/prisma/enums";
import { HEARTBEAT_INTERVAL_SECONDS, HEARTBEAT_TIMEOUT_MS } from "../machines/runtime/machine-runtime.constants";

const INTERVAL_MS = HEARTBEAT_INTERVAL_SECONDS * 1000;

/** "09:30" → that time on the IST day of `day`. */
function atTime(day: Date, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const { year, month, day: date } = istParts(day);

  return istInstant(year, month, date, hours, minutes);
}

const overlapSeconds = (start: Date, end: Date, from: Date, to: Date) =>
  Math.max(0, Math.round((Math.min(end.getTime(), to.getTime()) - Math.max(start.getTime(), from.getTime())) / 1000));

/**
 * Team today: per agent of a CSP (the CSP and its KOs), from the PCs.
 * - online time: the PC's heartbeat sessions (a session is on while
 *   heartbeats arrive with at most one missed);
 * - active time: SBI work started and stopped on the desktop (activity start
 *   → stop);
 * - late / early: against the working day the CSP sets.
 */
export default class TeamService {
  constructor(private readonly db: PrismaDb) {}

  async today(input: { agentIds: string[]; day?: Date }) {
    const now = new Date();
    const day = input.day ?? now;
    const from = startOfIstDay(day);
    const to = endOfIstDay(day);
    const until = now < to ? now : to;
    const isToday = istDateKey(day) === istDateKey(now);

    const agents = await this.db.agent.findMany({
      where: { agentId: { in: input.agentIds }, isDeleted: false, type: { in: [AgentType.CSP, AgentType.KO] } },
      select: { agentId: true, name: true, type: true, parentAgentId: true, workdayStart: true, workdayEnd: true },
      orderBy: [{ type: "asc" }, { agentId: "asc" }],
    });

    // The working day is the CSP's (a KO follows its CSP).
    const cspIds = [...new Set(agents.map((agent) => (agent.type === AgentType.CSP ? agent.agentId : agent.parentAgentId)).filter((id): id is string => !!id))];
    const csps = await this.db.agent.findMany({
      where: { agentId: { in: cspIds } },
      select: { agentId: true, workdayStart: true, workdayEnd: true },
    });
    const workdayOf = new Map(csps.map((csp) => [csp.agentId, csp]));

    const ids = agents.map((agent) => agent.agentId);
    const machines = await this.db.machine.findMany({
      where: { isDeleted: false, OR: [{ currentAgentId: { in: ids } }, { agentId: { in: ids } }] },
      select: { id: true, machineName: true, machineCode: true, agentId: true, currentAgentId: true, lastHeartbeatAt: true },
    });
    const machineIds = machines.map((machine) => machine.id);

    const [sessions, activities] = await Promise.all([
      this.db.machineSession.findMany({
        where: { machineId: { in: machineIds }, startedAt: { lte: to }, OR: [{ endedAt: null }, { endedAt: { gte: from } }] },
        select: { machineId: true, startedAt: true, endedAt: true, lastHeartbeatAt: true, firstAgentId: true, lastAgentId: true },
      }),
      this.db.cspActivitySession.findMany({
        where: { agentId: { in: ids }, startedAt: { lte: to }, OR: [{ endedAt: null }, { endedAt: { gte: from } }] },
        select: { agentId: true, startedAt: true, endedAt: true, lastHeartbeatAt: true },
      }),
    ]);

    const machineById = new Map(machines.map((machine) => [machine.id, machine]));

    const members = agents.map((agent) => {
      const own = machines.filter((machine) => (machine.currentAgentId ?? machine.agentId) === agent.agentId);
      const ownSessions = sessions.filter((session) => {
        const machine = machineById.get(session.machineId);

        return (session.lastAgentId ?? session.firstAgentId ?? machine?.currentAgentId ?? machine?.agentId) === agent.agentId;
      });

      let onlineSeconds = 0;
      let firstLoginAt: Date | null = null;
      let lastSeenAt: Date | null = null;

      for (const session of ownSessions) {
        // Counted up to the last heartbeat (+ one interval), not the time the
        // timeout job closed it.
        const heard = session.lastHeartbeatAt ? new Date(session.lastHeartbeatAt.getTime() + INTERVAL_MS) : session.startedAt;
        const end = new Date(Math.min((session.endedAt ?? until).getTime(), heard.getTime(), until.getTime()));

        onlineSeconds += overlapSeconds(session.startedAt, end, from, until);

        const start = session.startedAt < from ? from : session.startedAt;

        if (start <= until && (!firstLoginAt || start < firstLoginAt)) firstLoginAt = start;
        if (session.lastHeartbeatAt && session.lastHeartbeatAt >= from && (!lastSeenAt || session.lastHeartbeatAt > lastSeenAt)) {
          lastSeenAt = session.lastHeartbeatAt;
        }
      }

      const activeSeconds = activities
        .filter((activity) => activity.agentId === agent.agentId)
        .reduce((total, activity) => {
          const end = activity.endedAt ?? new Date(Math.min(activity.lastHeartbeatAt.getTime() + INTERVAL_MS, until.getTime()));

          return total + overlapSeconds(activity.startedAt, end, from, until);
        }, 0);

      const online = isToday && own.some((machine) => machine.lastHeartbeatAt && now.getTime() - machine.lastHeartbeatAt.getTime() <= HEARTBEAT_TIMEOUT_MS);
      const workday = workdayOf.get(agent.type === AgentType.CSP ? agent.agentId : agent.parentAgentId ?? "");
      const start = workday?.workdayStart ? atTime(day, workday.workdayStart) : null;
      const end = workday?.workdayEnd ? atTime(day, workday.workdayEnd) : null;

      const lateMinutes = start && firstLoginAt && firstLoginAt > start ? Math.round((firstLoginAt.getTime() - start.getTime()) / 60_000) : 0;
      const earlyLeaveMinutes =
        end && lastSeenAt && !online && until >= end && lastSeenAt < end ? Math.round((end.getTime() - lastSeenAt.getTime()) / 60_000) : 0;

      return {
        agentId: agent.agentId,
        name: agent.name,
        type: agent.type,
        machineName: own[0]?.machineName ?? own[0]?.machineCode ?? null,
        machines: own.map((machine) => ({ machineCode: machine.machineCode, machineName: machine.machineName })),
        online,
        firstLoginAt,
        lastSeenAt,
        onlineSeconds,
        activeSeconds,
        lateMinutes,
        earlyLeaveMinutes,
        status: !firstLoginAt ? (start && until > start ? "NOT_LOGGED_IN" : "NOT_STARTED") : online ? "ONLINE" : "OFFLINE",
      };
    });

    const settings = cspIds.length === 1 ? workdayOf.get(cspIds[0]) : null;

    return {
      date: istDateKey(day),
      startTime: settings?.workdayStart ?? null,
      endTime: settings?.workdayEnd ?? null,
      members,
    };
  }

  async getSettings(cspAgentId: string) {
    const csp = await this.db.agent.findUnique({ where: { agentId: cspAgentId }, select: { workdayStart: true, workdayEnd: true } });

    return { workdayStart: csp?.workdayStart ?? null, workdayEnd: csp?.workdayEnd ?? null };
  }

  async updateSettings(cspAgentId: string, change: { workdayStart?: string | null; workdayEnd?: string | null }) {
    const current = await this.getSettings(cspAgentId);
    const next = { ...current, ...change };

    if (next.workdayStart && next.workdayEnd && next.workdayStart >= next.workdayEnd) {
      throw new BadRequestError("The start time must be before the closing time.");
    }

    await this.db.agent.update({ where: { agentId: cspAgentId }, data: next });

    return next;
  }
}
