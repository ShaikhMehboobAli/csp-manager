import cron from "node-cron";

import prisma from "../config/prisma";

import { Logger } from "../core/utils/logger";

import MachineSessionRepository from "../modules/machines/runtime/machine-session.repository";

import { HEARTBEAT_TIMEOUT_MS } from "../modules/machines/runtime/machine-runtime.constants";

import { SessionEndReason } from "../generated/prisma/enums";

export default class MachineSessionTimeoutJob {
  static start() {
    cron.schedule("* * * * *", async () => {
      try {
        const repository = new MachineSessionRepository(prisma);

        const timeoutDate = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

        const sessions = await repository.findTimedOutSessions(timeoutDate);

        if (sessions.length === 0) {
          return;
        }

        for (const session of sessions) {
          const endedAt = new Date();

          Logger.info(
            `[MachineSessionTimeoutJob] Closing session ${session.machineSessionId} for machine ${session.machineId}`,
          );

          await repository.closeSession(
            session.id,
            // session.lastHeartbeatAt!,
            endedAt,
            SessionEndReason.HEARTBEAT_TIMEOUT,
          );
        }

        Logger.success(
          `[MachineSessionTimeoutJob] Closed ${sessions.length} timed-out session(s).`,
        );
      } catch (error) {
        Logger.error("[MachineSessionTimeoutJob]");
        console.error(error);
      }
    });
  }
}
