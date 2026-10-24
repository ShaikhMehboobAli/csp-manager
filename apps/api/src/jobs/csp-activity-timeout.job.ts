import cron from "node-cron";

import prisma from "../config/prisma";

import { Logger } from "../core/utils/logger";

import CspActivityRepository from "../modules/machines/runtime/csp-activity.repository";

import { HEARTBEAT_TIMEOUT_MS } from "../modules/machines/runtime/machine-runtime.constants";

import { ActivityEndReason } from "../generated/prisma/enums";

/**
 * Closes CSP activity sessions whose desktop stopped sending heartbeats
 * (crash, forced kill, power loss, network loss). The session ends at its
 * last heartbeat so dead time is not counted as activity.
 */
export default class CspActivityTimeoutJob {
  static start() {
    cron.schedule("* * * * *", async () => {
      try {
        const repository = new CspActivityRepository(prisma);

        const sessions = await repository.findTimedOutSessions(
          new Date(Date.now() - HEARTBEAT_TIMEOUT_MS),
        );

        if (sessions.length === 0) {
          return;
        }

        for (const session of sessions) {
          await repository.closeSession(
            session,
            session.lastHeartbeatAt,
            ActivityEndReason.HEARTBEAT_TIMEOUT,
          );
        }

        Logger.success(
          `[CspActivityTimeoutJob] Closed ${sessions.length} timed-out activity session(s).`,
        );
      } catch (error) {
        Logger.error("[CspActivityTimeoutJob]");
        console.error(error);
      }
    });
  }
}
