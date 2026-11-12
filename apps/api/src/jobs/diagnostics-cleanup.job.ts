import cron from "node-cron";

import prisma from "../config/prisma";
import { Logger } from "../core/utils/logger";
import DiagnosticsService, { DIAGNOSTICS_KEEP_DAYS } from "../modules/machines/diagnostics/diagnostics.service";

/** Every day at 3:45 AM: desktop log uploads older than 14 days are deleted. */
export default class DiagnosticsCleanupJob {
  static start() {
    cron.schedule("45 3 * * *", async () => {
      try {
        const deleted = await new DiagnosticsService(prisma).cleanup();

        if (deleted > 0) {
          Logger.info(`[DiagnosticsCleanupJob] deleted ${deleted} request(s) older than ${DIAGNOSTICS_KEEP_DAYS} days`);
        }
      } catch (error) {
        Logger.error("[DiagnosticsCleanupJob]");
        console.error(error);
      }
    });
  }
}
