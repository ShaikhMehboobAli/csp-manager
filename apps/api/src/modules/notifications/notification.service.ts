import { PrismaDb } from "../../core/database/prisma.types";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { Prisma } from "../../generated/prisma/client";
import { NotificationKind, NotificationType } from "../../generated/prisma/enums";

import PushService, { LOCKED_GROUPS } from "./push.service";

/**
 * In-app notifications for a CSP / BC user (the app lists them; push is
 * pending, pre-production checklist 2.14). An agent without a login (KO)
 * has no inbox: nothing is written.
 */
export default class NotificationService {
  constructor(private readonly db: PrismaDb) {}

  async notifyAgent(
    agentId: string,
    input: {
      title: string;
      message: string;
      kind: NotificationKind;
      type?: NotificationType;
      data?: Prisma.InputJsonValue;
    },
  ) {
    const user = await this.db.user.findUnique({ where: { agentId }, select: { id: true } });

    if (!user) {
      return null;
    }

    const notification = await this.db.notification.create({
      data: {
        userId: user.id,
        title: input.title,
        message: input.message,
        kind: input.kind,
        type: input.type ?? NotificationType.INFO,
        data: input.data,
      },
    });

    await new PushService(this.db).deliver(user.id, {
      title: input.title,
      body: input.message,
      kind: input.kind,
      data: input.data,
      notificationId: notification.id,
    });

    return notification;
  }

  // ---------------------------------------------------------------------------
  // Push preferences (push tokens come with login / refresh: auth.service)
  // ---------------------------------------------------------------------------

  async getPreferences(userId: string) {
    const row = await this.db.notificationPreference.findUnique({ where: { userId } });

    return {
      plan: true,
      cash: row?.cash ?? true,
      settlements: row?.settlements ?? true,
      machines: row?.machines ?? true,
      requests: row?.requests ?? true,
      locked: LOCKED_GROUPS,
    };
  }

  async updatePreferences(
    userId: string,
    change: Partial<Record<"cash" | "settlements" | "machines" | "requests", boolean>>,
  ) {
    await this.db.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...change },
      update: change,
    });

    return this.getPreferences(userId);
  }

  async list(userId: string, filter: { unreadOnly: boolean; page: number; limit: number }) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(filter.unreadOnly && { isRead: false }),
    };

    const [items, total, unread] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.db.notification.count({ where }),
      this.db.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        message: item.message,
        type: item.type,
        kind: item.kind,
        data: item.data,
        isRead: item.isRead,
        readAt: item.readAt,
        createdAt: item.createdAt,
      })),
      unread,
      pagination: {
        page: filter.page,
        limit: filter.limit,
        total,
        totalPages: Math.ceil(total / filter.limit),
      },
    };
  }

  async markRead(userId: string, notificationId: string | "ALL") {
    if (notificationId === "ALL") {
      const result = await this.db.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true, readAt: new Date() },
      });

      return { updated: result.count };
    }

    const result = await this.db.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundError("Notification not found.");
    }

    return { updated: result.count };
  }
}
