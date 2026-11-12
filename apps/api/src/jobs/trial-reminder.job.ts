import cron from "node-cron";

import prisma from "../config/prisma";
import { Logger } from "../core/utils/logger";
import TrialService from "../modules/subscriptions/trial/trial.service";

let running = false;

/** Hourly: tells owners their free trial ends within a day (once per trial). */
export default class TrialReminderJob {
  static start() {
    cron.schedule("15 * * * *", () => {
      void TrialReminderJob.runOnce();
    });
  }

  static async runOnce(now = new Date()) {
    if (running) {
      return;
    }

    running = true;

    try {
      const sent = await new TrialService(prisma).sendEndingReminders(now);

      if (sent > 0) {
        Logger.info(`[TrialReminderJob] reminded ${sent} trial owner(s)`);
      }
    } catch (error) {
      Logger.error("[TrialReminderJob]");
      console.error(error);
    } finally {
      running = false;
    }
  }
}
