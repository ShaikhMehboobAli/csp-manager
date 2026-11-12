import { PrismaDb } from "../../core/database/prisma.types";
import { withTransaction } from "../../core/database/transaction";
import { addDays, istCalendarDate } from "../../core/utils/ist";
import ReceiptRetentionSettingsService from "../settings/receipt-retention-settings.service";

import ReceiptDailyCountRepository from "./repository/receipt-daily-count.repository";
import ReceiptSlipService from "./receipt-slip.service";

// Small batches keep each delete well under the statement timeout.
const DELETE_BATCH_SIZE = 5000;

/**
 * Receipts before this instant are refused on upload (see
 * ReceiptRetentionSettingsService.uploadCutoff). Refusing them stops a deleted
 * receipt from being uploaded and counted again.
 */
export async function receiptUploadCutoff(db: PrismaDb, now = new Date()) {
  const service = new ReceiptRetentionSettingsService(db);

  return service.uploadCutoff(await service.getSettings(), now);
}

export default class ReceiptRetentionService {
  private readonly repository: ReceiptDailyCountRepository;

  private readonly settingsService: ReceiptRetentionSettingsService;

  constructor(db: PrismaDb) {
    this.repository = new ReceiptDailyCountRepository(db);
    this.settingsService = new ReceiptRetentionSettingsService(db);
  }

  /**
   * 1. repair counts for receipts that were saved without them,
   * 2. mark the cutoff as deleted (before deleting, so a half-finished run
   *    still refuses those uploads),
   * 3. delete old receipts, oldest first,
   * 4. delete counts older than the count period.
   * Each step commits on its own; a failed run is recorded and the next run
   * continues where it stopped.
   */
  async run({ dryRun }: { dryRun: boolean }) {
    const startedAt = new Date();
    const settings = await this.settingsService.getSettings({ fresh: true });
    const receiptCutoff = this.settingsService.retentionCutoff(
      settings.receiptRetentionDays,
      startedAt,
    );
    const countCutoff = istCalendarDate(
      addDays(startedAt, -settings.countRetentionDays),
    );

    if (dryRun) {
      const [receiptsToDelete, undercountedDays] = await Promise.all([
        this.repository.countReceiptsBefore(receiptCutoff),
        this.repository.findUndercountedDays(),
      ]);

      return {
        dryRun,
        settings,
        receiptCutoff,
        countCutoff,
        receiptsToDelete,
        undercountedDays: undercountedDays.length,
        receiptsDeleted: 0,
        slipsDeleted: 0,
        countsDeleted: 0,
        countsRepaired: 0,
      };
    }

    let receiptsDeleted = 0;
    let countsDeleted = 0;
    let countsRepaired = 0;
    let slipsDeleted = 0;

    try {
      const undercounted = await this.repository.findUndercountedDays();

      if (undercounted.length > 0) {
        countsRepaired = await withTransaction((tx) =>
          new ReceiptDailyCountRepository(tx).repairDays(undercounted),
        );
      }

      if (
        !settings.receiptsDeletedBefore ||
        settings.receiptsDeletedBefore < receiptCutoff
      ) {
        await this.settingsService.updateState({
          receiptsDeletedBefore: receiptCutoff.toISOString(),
        });
      }

      for (;;) {
        const { deleted, slipKeys } = await this.repository.deleteReceiptsBefore(
          receiptCutoff,
          DELETE_BATCH_SIZE,
        );

        receiptsDeleted += deleted;

        // Their slip images too (best effort: an S3 lifecycle rule on
        // receipt-slips/ is the backstop).
        slipsDeleted += await ReceiptSlipService.deleteSlips(slipKeys).catch(() => 0);

        if (deleted < DELETE_BATCH_SIZE) {
          break;
        }
      }

      countsDeleted = await this.repository.deleteCountsBefore(countCutoff);

      await this.recordRun({
        status: "SUCCESS",
        startedAt,
        receiptCutoff,
        receiptsDeleted,
        slipsDeleted,
        countsDeleted,
        countsRepaired,
      });
    } catch (error) {
      // Best effort: the console shows the failure; the job logs it.
      await this.recordRun({
        status: "FAILED",
        startedAt,
        receiptCutoff,
        receiptsDeleted,
        slipsDeleted,
        countsDeleted,
        countsRepaired,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);

      throw error;
    }

    return {
      dryRun,
      settings,
      receiptCutoff,
      countCutoff,
      receiptsToDelete: 0,
      undercountedDays: 0,
      receiptsDeleted,
      slipsDeleted,
      countsDeleted,
      countsRepaired,
    };
  }

  private recordRun(run: {
    status: "SUCCESS" | "FAILED";
    startedAt: Date;
    receiptCutoff: Date;
    receiptsDeleted: number;
    slipsDeleted: number;
    countsDeleted: number;
    countsRepaired: number;
    error?: string;
  }) {
    return this.settingsService.updateState({
      lastRun: {
        ...run,
        startedAt: run.startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        receiptCutoff: run.receiptCutoff.toISOString(),
        // Error messages can be long (Prisma); keep the console readable.
        ...(run.error && { error: run.error.slice(0, 500) }),
      },
    });
  }
}
