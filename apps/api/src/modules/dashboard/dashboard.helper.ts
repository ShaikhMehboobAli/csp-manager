// export const HEARTBEAT_TIMEOUT_MS = 360 * 1000;

import { HEARTBEAT_TIMEOUT_MS } from "../machines/runtime/machine-runtime.constants";
import {
  addDays,
  endOfIstDay,
  istDateKey,
  istParts,
  startOfIstDay,
} from "../../core/utils/ist";

export function getMachineStatus(lastHeartbeatAt: Date | null) {
  if (!lastHeartbeatAt) {
    return "OFFLINE";
  }

  const diff = Date.now() - lastHeartbeatAt.getTime();

  return diff <= HEARTBEAT_TIMEOUT_MS ? "ONLINE" : "OFFLINE";
}

export function getTodayRange() {
  const now = new Date();

  return {
    start: startOfIstDay(now),
    end: endOfIstDay(now),
  };
}

/** Chart bucket label for a transaction, on the IST calendar. */
export function getTrendLabel(
  date: Date,
  groupBy: "hour" | "day" | "week" | "month" | "year",
): string {
  const { year, month, hour, weekday } = istParts(date);

  switch (groupBy) {
    case "hour":
      return `${hour}:00`;

    case "day":
      return istDateKey(date);

    // Week starts on Sunday.
    case "week":
      return istDateKey(addDays(date, -weekday));

    case "month":
      return `${year}-${String(month + 1).padStart(2, "0")}`;

    case "year":
      return `${year}`;
  }
}

// export function buildAgentScope(agentIds?: string[]) {
//   if (!agentIds) {
//     return {};
//   }

//   return {
//     agentId: {
//       in: agentIds,
//     },
//   };
// }

export function buildAgentScope(agentIds?: string[], agentId?: string) {
  if (agentId) {
    return {
      agentId,
    };
  }

  if (agentIds?.length) {
    return {
      agentId: {
        in: agentIds,
      },
    };
  }

  return {};
}
