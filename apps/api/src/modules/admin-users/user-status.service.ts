import prisma from "../../config/prisma";
import { withTransaction } from "../../core/database/transaction";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { forgetUserAccess } from "../../core/services/user-access.service";
import {
  AuditAction,
  AuditEntity,
  UserRole,
  UserStatus,
} from "../../generated/prisma/enums";

import type { UpdateUserStatusDto } from "./user-status.validation";

const select = {
  id: true,
  agentId: true,
  email: true,
  role: true,
  status: true,
  statusReason: true,
  statusChangedAt: true,
  lastLoginAt: true,
} as const;

/**
 * Super admin: block, suspend or reactivate a login account. Blocking ends
 * every session and the next request with a still-valid access token is
 * refused (403 ACCOUNT_BLOCKED / ACCOUNT_SUSPENDED), so access stops at once.
 */
export default class UserStatusService {
  async get(agentId: string) {
    const user = await prisma.user.findUnique({ where: { agentId }, select });

    if (!user) {
      throw new NotFoundError("User not found.");
    }

    const activeSessions = await prisma.userSession.count({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    });

    return { ...user, activeSessions };
  }

  async update(
    agentId: string,
    data: UpdateUserStatusDto,
    admin: { userId: string },
    client: { ipAddress: string | null; userAgent: string | null },
  ) {
    const updated = await withTransaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { agentId }, select });

      if (!user) {
        throw new NotFoundError("User not found.");
      }

      if (user.role === UserRole.SUPER_ADMIN) {
        throw new BadRequestError("A super admin account can't be blocked here.");
      }

      if (user.status === UserStatus.PENDING) {
        throw new BadRequestError("This account hasn't finished signing up yet.");
      }

      const next = await tx.user.update({
        where: { id: user.id },
        data: {
          status: data.status,
          statusReason: data.status === UserStatus.ACTIVE ? null : data.reason,
          statusChangedAt: new Date(),
          updatedBy: admin.userId,
        },
        select,
      });

      let revokedSessions = 0;

      if (data.status !== UserStatus.ACTIVE) {
        ({ count: revokedSessions } = await tx.userSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }));
      }

      await tx.auditLog.create({
        data: {
          userId: admin.userId,
          action: data.status === UserStatus.ACTIVE ? AuditAction.ACTIVATE : AuditAction.DEACTIVATE,
          entityType: AuditEntity.USER,
          entityId: user.id,
          description: `${agentId}: ${user.status} → ${data.status}${data.reason ? ` (${data.reason})` : ""}`,
          oldData: { status: user.status, statusReason: user.statusReason },
          newData: { status: next.status, statusReason: next.statusReason },
          ...client,
        },
      });

      return { ...next, revokedSessions };
    });

    forgetUserAccess(updated.id);

    return updated;
  }
}
