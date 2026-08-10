import cron from "node-cron";

import prisma from "../config/prisma";
import runtimeConfig from "../config/runtime.config";

import { Logger } from "../core/utils/logger";

import MachineSessionRepository from "../modules/machines/runtime/machine-session.repository";
import { MachineSessionStatus } from "../generated/prisma/enums";

export default class MachineSessionCleanupJob {
  static start() {
    // Every day at 2 AM
    cron.schedule("0 2 * * *", async () => {
      try {
        const repository = new MachineSessionRepository(prisma);

        const cutoffDate = new Date();

        cutoffDate.setDate(
          cutoffDate.getDate() - runtimeConfig.sessionRetentionDays,
        );

        const activeCount =
          await repository.countExpiredActiveSessions(cutoffDate);

        if (activeCount > 0) {
          Logger.warn(
            `[MachineSessionCleanupJob] Found ${activeCount} ACTIVE session(s) older than retention period.`,
          );
        }

        const total = await repository.countExpiredSessions(cutoffDate);

        if (total === 0) {
          Logger.info("[MachineSessionCleanupJob] No expired sessions found.");
          return;
        }

        if (runtimeConfig.cleanupDryRun) {
          Logger.info(
            `[MachineSessionCleanupJob] DRY RUN - Would delete ${total} session(s).`,
          );

          return;
        }

        await repository.deleteExpiredSessions(cutoffDate);

        Logger.success(
          `[MachineSessionCleanupJob] Deleted ${total} expired session(s).`,
        );
        Logger.info(
          `[MachineSessionCleanupJob] Cutoff Date: ${cutoffDate.toISOString()}`,
        );
      } catch (error) {
        Logger.error("[MachineSessionCleanupJob]");

        console.error(error);
      }
    });
  }
}
