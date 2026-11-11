import { PrismaDb } from "../../core/database/prisma.types";
import { Logger } from "../../core/utils/logger";
import { NotificationKind } from "../../generated/prisma/enums";

export type PushGroup = "plan" | "cash" | "settlements" | "machines" | "requests";

/** Groups the user can't switch off. */
export const LOCKED_GROUPS: PushGroup[] = ["plan"];

/** Which push group a notification kind belongs to. */
export function pushGroupOf(kind: NotificationKind): PushGroup {
  switch (kind) {
    case NotificationKind.CASH_ACTIVATION_DIFFERENCE:
      return "cash";
    case NotificationKind.BC_UNLINKED:
      return "requests";
    default:
      // GENERAL, SUBSCRIPTION_*, MANDATE_*, TRIAL_*: always sent.
      return "plan";
  }
}

export type PushMessage = { title: string; body: string; kind: NotificationKind; data?: unknown; notificationId: string };

/**
 * Push for in-app notifications. The provider (FCM; APNs through FCM) isn't
 * set up yet (pre-production checklist 2.14): devices and preferences are
 * stored and the group check runs, but nothing leaves the server until
 * `send` is wired to FCM. Never throws: a push failure must not undo the
 * notification.
 */
export default class PushService {
  constructor(private readonly db: PrismaDb) {}

  async deliver(userId: string, message: PushMessage) {
    try {
      const group = pushGroupOf(message.kind);

      if (!LOCKED_GROUPS.includes(group)) {
        const preference = await this.db.notificationPreference.findUnique({ where: { userId } });

        if (preference && preference[group as Exclude<PushGroup, "plan">] === false) {
          return 0;
        }
      }

      const devices = await this.db.notificationDevice.findMany({ where: { userId }, select: { token: true, platform: true } });

      if (devices.length === 0) {
        return 0;
      }

      await this.send(devices, message);

      return devices.length;
    } catch (error) {
      Logger.error(`[Push] ${(error as Error).message}`);

      return 0;
    }
  }

  /** Provider stand-in: FCM goes here. */
  private async send(devices: { token: string; platform: string }[], message: PushMessage) {
    Logger.info(`[Push] (no provider yet) ${message.kind} → ${devices.length} device(s)`);
  }
}
