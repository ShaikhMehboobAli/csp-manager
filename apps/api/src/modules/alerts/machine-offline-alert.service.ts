import { PrismaDb } from "../../core/database/prisma.types";
import { ActivationStatus, MachineStatus, NotificationKind, NotificationType } from "../../generated/prisma/enums";
import NotificationService from "../notifications/notification.service";

import { istTime } from "./alert-time.helper";

/** A PC with no heartbeat for this long is offline (owner decision, 2026-11-11). */
export const MACHINE_OFFLINE_AFTER_MS = 60 * 60 * 1000;

/**
 * Tells the owner (CSP / BC) when one of its PCs sent no heartbeat for 1
 * hour. Once per outage: `Machine.offlineAlertAt` is set here and cleared by
 * the next heartbeat, so the next outage alerts again. Any time of day.
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

    for (const machine of machines) {
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

      await new NotificationService(this.db).notifyAgent(activation.subscription.ownerId, {
        title: "PC offline",
        message: `${pc}${who} has been offline for over an hour (last seen ${istTime(lastSeen)}). Check the PC, its internet and the CSP Manager service.`,
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
