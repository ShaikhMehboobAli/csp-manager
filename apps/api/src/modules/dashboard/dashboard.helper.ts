const HEARTBEAT_TIMEOUT_MS = 360 * 1000;

export function getMachineStatus(lastHeartbeatAt: Date | null) {
  if (!lastHeartbeatAt) {
    return "OFFLINE";
  }

  const diff = Date.now() - lastHeartbeatAt.getTime();

  return diff <= HEARTBEAT_TIMEOUT_MS ? "ONLINE" : "OFFLINE";
}

export function getTodayRange() {
  const start = new Date();

  start.setHours(0, 0, 0, 0);

  const end = new Date();

  end.setHours(23, 59, 59, 999);

  return {
    start,
    end,
  };
}
