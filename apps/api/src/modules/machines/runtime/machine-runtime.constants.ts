export const HEARTBEAT_INTERVAL_SECONDS = 60;

// A session is on while heartbeats arrive with at most one missed: it ends
// (and the PC shows offline) after 2 intervals without one.
export const HEARTBEAT_TIMEOUT_MULTIPLIER = 2;

export const HEARTBEAT_TIMEOUT_SECONDS =
  HEARTBEAT_INTERVAL_SECONDS * HEARTBEAT_TIMEOUT_MULTIPLIER;

export const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_TIMEOUT_SECONDS * 1000;
