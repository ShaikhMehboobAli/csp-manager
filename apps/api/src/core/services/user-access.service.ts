import prisma from "../../config/prisma";
import { UserStatus } from "../../generated/prisma/enums";

import { ForbiddenError } from "../errors/ForbiddenError";
import { UnauthorizedError } from "../errors/UnauthorizedError";

/**
 * Checked on every authenticated request, so blocking a user (or changing
 * their password) cuts off access at once instead of when the 15-minute
 * access token runs out. Looked up at most every 10 s per user per server;
 * a change on this server clears it right away.
 */
const CACHE_TTL_MS = 10_000;

type UserAccess = {
  status: UserStatus;
  statusReason: string | null;
  passwordChangedAt: Date | null;
  expiresAt: number;
};

const cache = new Map<string, UserAccess>();

async function load(userId: string) {
  const known = cache.get(userId);

  if (known && known.expiresAt > Date.now()) {
    return known;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, statusReason: true, passwordChangedAt: true },
  });

  if (!user) {
    cache.delete(userId);

    return null;
  }

  const access = { ...user, expiresAt: Date.now() + CACHE_TTL_MS };

  if (cache.size > 10_000) {
    cache.clear();
  }

  cache.set(userId, access);

  return access;
}

/** Throws when the user may no longer use the API with this access token. */
export async function assertUserAccess(userId: string, issuedAt?: number) {
  const access = await load(userId);

  if (!access) {
    throw new UnauthorizedError("Invalid token.");
  }

  const reason = access.statusReason ? ` Reason: ${access.statusReason}` : "";

  if (access.status === UserStatus.BLOCKED) {
    throw new ForbiddenError(`Your account has been blocked.${reason}`);
  }

  if (access.status === UserStatus.SUSPENDED) {
    throw new ForbiddenError(`Your account has been suspended.${reason}`);
  }

  // Tokens issued before a password change or reset stop working.
  if (
    issuedAt !== undefined &&
    access.passwordChangedAt &&
    issuedAt < Math.floor(access.passwordChangedAt.getTime() / 1000)
  ) {
    throw new UnauthorizedError("Session ended. Please log in again.");
  }
}

/** Drops the cached state after a status or password change. */
export function forgetUserAccess(userId: string) {
  cache.delete(userId);
}
