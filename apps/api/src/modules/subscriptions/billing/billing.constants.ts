/** Upgrades are allowed in the first 12 days of a purchase or renewal. */
export const UPGRADE_WINDOW_DAYS = 12;

/** A failed renewal is retried twice, 15 minutes apart, then the plan stops. */
export const RENEWAL_RETRY_MINUTES = 15;
export const RENEWAL_MAX_ATTEMPTS = 3;

/** A charge the gateway hasn't answered after this counts as a failed attempt. */
export const RENEWAL_PENDING_TIMEOUT_MINUTES = 30;

/** A renewal still unresolved this long after the end date is stopped (safety net). */
export const RENEWAL_STUCK_HOURS = 6;

/** A mandate runs for up to 25 years. */
export const MANDATE_YEARS = 25;
