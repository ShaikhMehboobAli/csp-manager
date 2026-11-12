import { env } from "../../config/env";

/**
 * DEV ONLY — REMOVE BEFORE PRODUCTION (pre-production checklist 2.11).
 * Until activation passwords are emailed, owners can see them again in the
 * activation list/detail. Disabled when NODE_ENV=production.
 */
export const EXPOSE_ACTIVATION_PASSWORD = env.nodeEnv !== "production";

export function storablePlainPassword(password: string) {
  return EXPOSE_ACTIVATION_PASSWORD ? password : null;
}

/** Renames the stored column to `activationPassword`, or drops it. */
export function withVisiblePassword<
  T extends { activationPasswordPlain: string | null },
>(activation: T) {
  const { activationPasswordPlain, ...rest } = activation;

  return EXPOSE_ACTIVATION_PASSWORD
    ? { ...rest, activationPassword: activationPasswordPlain }
    : rest;
}
