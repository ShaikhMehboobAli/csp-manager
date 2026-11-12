import cron from "node-cron";

import EmailService from "../core/services/email.service";
import { Logger } from "../core/utils/logger";

/** Daily 03:50: email logs older than 30 days (recipients are personal data). */
export default class EmailLogCleanupJob {
  static start() {
    cron.schedule("50 3 * * *", async () => {
      try {
        const deleted = await EmailService.cleanup();

        if (deleted > 0) Logger.info(`[EmailLogCleanupJob] deleted ${deleted} email log(s)`);
      } catch (error) {
        Logger.error("[EmailLogCleanupJob]");
        console.error(error);
      }
    });
  }
}
