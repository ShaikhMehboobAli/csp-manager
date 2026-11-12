import cron from "node-cron";

import prisma from "../config/prisma";
import { Logger } from "../core/utils/logger";
import DayCloseReminderService from "../modules/alerts/day-close-reminder.service";

let running = false;

/** Every 5 min: CSPs hear which agents haven't closed the day (once per agent per day). */
export default class DayCloseReminderJob {
  static start() {
    cron.schedule("*/5 * * * *", () => {
      void DayCloseReminderJob.runOnce();
    });
  }

  static async runOnce(now = new Date()) {
    if (running) return;
    running = true;

    try {
      const sent = await new DayCloseReminderService(prisma).sendAppReminders(now);

      if (sent > 0) Logger.info(`[DayCloseReminderJob] ${sent} reminder(s) sent`);
    } catch (error) {
      Logger.error("[DayCloseReminderJob]");
      console.error(error);
    } finally {
      running = false;
    }
  }
}
