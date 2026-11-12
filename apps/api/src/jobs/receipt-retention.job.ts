import cron from "node-cron";

import prisma from "../config/prisma";
import runtimeConfig from "../config/runtime.config";

import { Logger } from "../core/utils/logger";

import ReceiptRetentionService from "../modules/receipts/receipt-retention.service";

export default class ReceiptRetentionJob {
  private static running = false;

  static start() {
    // Every day at 3:30 AM IST, after the session cleanup.
    cron.schedule(
      "30 3 * * *",
      async () => {
        if (ReceiptRetentionJob.running) {
          return;
        }

        ReceiptRetentionJob.running = true;

        try {
          const result = await new ReceiptRetentionService(prisma).run({
            dryRun: runtimeConfig.cleanupDryRun,
          });

          if (result.dryRun) {
            Logger.info(
              `[ReceiptRetentionJob] DRY RUN - Would delete ${result.receiptsToDelete} receipt(s) before ${result.receiptCutoff.toISOString()} (${result.settings.receiptRetentionDays} days); ${result.undercountedDays} day(s) need count repair.`,
            );

            return;
          }

          Logger.success(
            `[ReceiptRetentionJob] Deleted ${result.receiptsDeleted} receipt(s) before ${result.receiptCutoff.toISOString()} and ${result.countsDeleted} daily count row(s) before ${result.countCutoff.toISOString().slice(0, 10)}; repaired ${result.countsRepaired} count row(s).`,
          );
        } catch (error) {
          Logger.error("[ReceiptRetentionJob]");

          console.error(error);
        } finally {
          ReceiptRetentionJob.running = false;
        }
      },
      { timezone: "Asia/Kolkata" },
    );
  }
}
