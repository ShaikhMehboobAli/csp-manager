import cron from "node-cron";

import prisma from "../config/prisma";
import { Logger } from "../core/utils/logger";
import MachineOfflineAlertService from "../modules/alerts/machine-offline-alert.service";

let running = false;

/** Every 5 min: owners hear about PCs with no heartbeat for 1 hour (once per outage). */
export default class MachineOfflineAlertJob {
  static start() {
    cron.schedule("*/5 * * * *", () => {
      void MachineOfflineAlertJob.runOnce();
    });
  }

  static async runOnce(now = new Date()) {
    if (running) return;
    running = true;

    try {
      const sent = await new MachineOfflineAlertService(prisma).run(now);

      if (sent > 0) Logger.info(`[MachineOfflineAlertJob] ${sent} PC(s) reported offline`);
    } catch (error) {
      Logger.error("[MachineOfflineAlertJob]");
      console.error(error);
    } finally {
      running = false;
    }
  }
}
