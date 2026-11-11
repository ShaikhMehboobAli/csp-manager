import { PrismaDb } from "../../core/database/prisma.types";
import { ActivationStatus, MachineStatus, NotificationKind, NotificationType } from "../../generated/prisma/enums";
import NotificationService from "../notifications/notification.service";

import { istDateKey } from "../../core/utils/ist";

import { atIstTime, istTime } from "./alert-time.helper";

/** A PC with no heartbeat for this long is offline (owner decision, 2026-11-11). */
export const MACHINE_OFFLINE_AFTER_MS = 60 * 60 * 1000;

/** Alert hours when the CSP set no working day (team settings). */
export const DEFAULT_ALERT_START = "09:00";
export const DEFAULT_ALERT_END = "19:00";

/**
 * Today's alert window for an owner: its working day (`workdayStart` /
 * `workdayEnd`), else 09:00–19:00 IST; a missing side uses the default.
 */
export function offlineAlertWindow(now: Date, workday: { workdayStart: string | null; workdayEnd: string | null } | null) {
  return {
    start: atIstTime(now, workday?.workdayStart ?? DEFAULT_ALERT_START),
    end: atIstTime(now, workday?.workdayEnd ?? DEFAULT_ALERT_END),
  };
}

/**
 * Only working-day time counts: offline since before the day started counts
 * from the start (a PC off overnight alerts 1 hour into the day, if still off).
 */
export function isOfflineAlertDue(now: Date, lastHeartbeatAt: Date, window: { start: Date; end: Date }) {
  if (now < window.start || now > window.end) {
    return false;
  }

  const since = lastHeartbeatAt > window.start ? lastHeartbeatAt : window.start;

  return now.getTime() - since.getTime() >= MACHINE_OFFLINE_AFTER_MS;
}

/**
 * Tells the owner (CSP / BC) when one of its PCs sent no heartbeat for 1
 * hour of its working day (see `offlineAlertWindow`); nothing outside it.
 * Once per outage: `Machine.offlineAlertAt` is set here and cleared by the
 * next heartbeat, so the next outage alerts again.
 */
export default class MachineOfflineAlertService {
  constructor(private readonly db: PrismaDb) {}

  async run(now = new Date()) {
    const machines = await this.db.machine.findMany({
      where: {
        status: MachineStatus.ACTIVE,
        isDeleted: false,
        offlineAlertAt: null,
        lastHeartbeatAt: { lt: new Date(now.getTime() - MACHINE_OFFLINE_AFTER_MS) },
        activations: { some: { status: ActivationStatus.ACTIVE } },
      },
      select: {
        id: true,
        machineCode: true,
        machineName: true,
        deviceName: true,
        currentAgentId: true,
        lastHeartbeatAt: true,
        activations: {
          where: { status: ActivationStatus.ACTIVE },
          select: { activationCode: true, subscription: { select: { ownerId: true } } },
          take: 1,
        },
      },
      take: 500,
    });

    let sent = 0;
    const workdays = new Map<string, { workdayStart: string | null; workdayEnd: string | null } | null>();

    for (const machine of machines) {
      const ownerId = machine.activations[0]?.subscription.ownerId;

      if (!ownerId) {
        continue;
      }

      if (!workdays.has(ownerId)) {
        workdays.set(
          ownerId,
          await this.db.agent.findUnique({ where: { agentId: ownerId }, select: { workdayStart: true, workdayEnd: true } }),
        );
      }

      if (!isOfflineAlertDue(now, machine.lastHeartbeatAt!, offlineAlertWindow(now, workdays.get(ownerId) ?? null))) {
        continue; // outside the working day, or not an hour of it yet
      }

      // Claim it first: another API instance running the same job skips it.
      const { count } = await this.db.machine.updateMany({
        where: { id: machine.id, offlineAlertAt: null, lastHeartbeatAt: machine.lastHeartbeatAt },
        data: { offlineAlertAt: now },
      });

      const activation = machine.activations[0];

      if (count === 0 || !activation) {
        continue;
      }

      const agent = machine.currentAgentId
        ? await this.db.agent.findUnique({ where: { agentId: machine.currentAgentId }, select: { name: true } })
        : null;
      const pc = machine.machineName ?? machine.deviceName ?? machine.machineCode;
      const who = machine.currentAgentId ? ` (${agent?.name ?? machine.currentAgentId})` : "";
      const lastSeen = machine.lastHeartbeatAt!;
      const seen = istDateKey(lastSeen) === istDateKey(now) ? istTime(lastSeen) : `${istDateKey(lastSeen)} ${istTime(lastSeen)}`;

      await new NotificationService(this.db).notifyAgent(activation.subscription.ownerId, {
        title: "PC offline",
        message: `${pc}${who} has been offline for over an hour (last seen ${seen}). Check the PC, its internet and the CSP Manager service.`,
        kind: NotificationKind.MACHINE_OFFLINE,
        type: NotificationType.WARNING,
        data: {
          machineId: machine.id,
          machineCode: machine.machineCode,
          machineName: pc,
          agentId: machine.currentAgentId,
          activationCode: activation.activationCode,
          lastHeartbeatAt: lastSeen.toISOString(),
        },
      });

      sent += 1;
    }

    return sent;
  }
}
