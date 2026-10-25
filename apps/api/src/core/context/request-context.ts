import { AsyncLocalStorage } from "node:async_hooks";

import { CurrentUser } from "../types/auth.types";

/**
 * Per-request context, set by authMiddleware. Lets shared checks know who is
 * calling without threading the user through every service.
 */
const storage = new AsyncLocalStorage<{ user: CurrentUser }>();

export function runWithUser<T>(user: CurrentUser, callback: () => T): T {
  return storage.run({ user }, callback);
}

export function getCurrentUser(): CurrentUser | undefined {
  return storage.getStore()?.user;
}
