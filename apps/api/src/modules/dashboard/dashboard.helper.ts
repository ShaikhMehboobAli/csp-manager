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

export function getTrendLabel(
  date: Date,
  groupBy: "hour" | "day" | "week" | "month" | "year",
): string {
  switch (groupBy) {
    case "hour":
      return `${date.getHours()}:00`;

    case "day":
      return date.toISOString().split("T")[0];

    case "week": {
      const firstDay = new Date(date);
      firstDay.setDate(date.getDate() - date.getDay());
      return firstDay.toISOString().split("T")[0];
    }

    case "month":
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
        2,
        "0",
      )}`;

    case "year":
      return `${date.getFullYear()}`;
  }
}

export function buildAgentScope(agentIds?: string[]) {
  if (!agentIds) {
    return {};
  }

  return {
    agentId: {
      in: agentIds,
    },
  };
}
