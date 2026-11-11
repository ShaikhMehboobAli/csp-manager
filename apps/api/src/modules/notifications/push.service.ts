import prisma from "../../config/prisma";
import { PrismaDb } from "../../core/database/prisma.types";
import { isFcmEnabled, sendToTokens } from "../../core/services/fcm.service";
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

/** Devices of a live login session only: logout / revoke / expiry stop pushes. */
const liveDevices = (userId: string) => ({
  userId,
  session: { revokedAt: null, expiresAt: { gt: new Date() } },
});

/** Waits between "is the notification committed yet?" checks (ms). Transactions allow 15 s. */
const COMMIT_CHECKS_MS = [300, 1000, 2000, 4000, 8000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** FCM data values must be strings; objects are sent as JSON. */
function toFcmData(message: PushMessage): Record<string, string> {
  const data: Record<string, string> = { notificationId: message.notificationId, kind: message.kind };

  if (message.data && typeof message.data === "object" && !Array.isArray(message.data)) {
    for (const [key, value] of Object.entries(message.data as Record<string, unknown>)) {
      if (value === null || value === undefined || key in data) continue;
      data[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
  }

  return data;
}

/**
 * Push for in-app notifications, through FCM (APNs through FCM for iOS).
 *
 * `deliver` runs the group / preference check with the caller's db (often a
 * transaction) and returns how many devices will get it. The send itself
 * happens in the background, only once the notification row is committed:
 * a rolled-back notification never pushes, and the caller never waits on
 * FCM. Never throws: a push failure must not undo the notification.
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

      const devices = await this.db.notificationDevice.findMany({ where: liveDevices(userId), select: { token: true } });

      if (devices.length === 0) {
        return 0;
      }

      if (isFcmEnabled()) {
        void this.sendAfterCommit(userId, message);
      } else {
        Logger.info(`[Push] (FCM not configured) ${message.kind} → ${devices.length} device(s)`);
      }

      return devices.length;
    } catch (error) {
      Logger.error(`[Push] ${(error as Error).message}`);

      return 0;
    }
  }

  /** Sends once the notification is visible outside the caller's transaction. */
  private async sendAfterCommit(userId: string, message: PushMessage) {
    try {
      let committed = false;

      for (const wait of COMMIT_CHECKS_MS) {
        await sleep(wait);

        if (await prisma.notification.findUnique({ where: { id: message.notificationId }, select: { id: true } })) {
          committed = true;
          break;
        }
      }

      if (!committed) {
        return; // rolled back (or never committed): nothing to tell the user
      }

      // Re-read devices: one may have logged out meanwhile.
      const tokens = (await prisma.notificationDevice.findMany({ where: liveDevices(userId), select: { token: true } })).map((d) => d.token);

      if (tokens.length === 0) {
        return;
      }

      const { sent, deadTokens } = await sendToTokens(tokens, { title: message.title, body: message.body, data: toFcmData(message) });

      if (deadTokens.length > 0) {
        await prisma.notificationDevice.deleteMany({ where: { token: { in: deadTokens } } });
      }

      Logger.info(`[Push] ${message.kind} sent to ${sent}/${tokens.length} device(s); removed ${deadTokens.length} dead token(s)`);
    } catch (error) {
      Logger.error(`[Push] Send failed: ${(error as Error).message}`);
    }
  }
}
