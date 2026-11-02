import prisma from "../../config/prisma";
import RuntimeConfig from "../../config/runtime.config";
import { PrismaDb } from "../../core/database/prisma.types";
import { addDays, startOfIstDay } from "../../core/utils/ist";
import { Prisma } from "../../generated/prisma/client";

/** Set by the super admin. */
export const RECEIPT_RETENTION_SETTINGS_KEY = "receiptRetention";

/** Written by the retention job only, so the two never overwrite each other. */
export const RECEIPT_RETENTION_STATE_KEY = "receiptRetentionState";

export const MIN_RECEIPT_RETENTION_DAYS = 15;

const DEFAULT_RECEIPT_RETENTION_DAYS = 60;

export interface ReceiptRetentionRun {
  status: "SUCCESS" | "FAILED";
  startedAt: string;
  finishedAt: string;
  receiptCutoff: string;
  receiptsDeleted: number;
  countsDeleted: number;
  countsRepaired: number;
  error?: string;
}

interface ReceiptRetentionState {
  /**
   * Every receipt before this instant has been (or is being) deleted. Uploads
   * before it are refused even after the period is raised, so a deleted
   * receipt can't be uploaded and counted again.
   */
  receiptsDeletedBefore?: string;
  lastRun?: ReceiptRetentionRun;
}

export interface ReceiptRetentionSettings {
  receiptRetentionDays: number;
  countRetentionDays: number;
  receiptsDeletedBefore: Date | null;
}

// Read on every receipt upload, so cached per process like desktop settings.
const CACHE_TTL_MS = 60_000;

let cache: { value: ReceiptRetentionSettings; expiresAt: number } | null =
  null;

function validDays(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RECEIPT_RETENTION_DAYS
    ? value
    : null;
}

/** Env default, used until the super admin sets a value. */
function defaultReceiptRetentionDays() {
  return (
    validDays(RuntimeConfig.receiptRetentionDays) ??
    DEFAULT_RECEIPT_RETENTION_DAYS
  );
}

/**
 * Daily counts must outlive the receipts, so the count period is never
 * shorter than the receipt period.
 */
export function maxReceiptRetentionDays() {
  return Math.max(
    validDays(RuntimeConfig.receiptCountRetentionDays) ?? 365,
    MIN_RECEIPT_RETENTION_DAYS,
  );
}

export default class ReceiptRetentionSettingsService {
  constructor(private readonly db: PrismaDb = prisma) {}

  async getSettings({ fresh = false } = {}): Promise<ReceiptRetentionSettings> {
    if (!fresh && cache && cache.expiresAt > Date.now()) {
      return cache.value;
    }

    // Both keys in one read, so the period and the deleted-before mark are
    // always from the same moment.
    const rows = await this.db.appSetting.findMany({
      where: {
        key: {
          in: [RECEIPT_RETENTION_SETTINGS_KEY, RECEIPT_RETENTION_STATE_KEY],
        },
      },
    });

    const settings = (rows.find(
      (row) => row.key === RECEIPT_RETENTION_SETTINGS_KEY,
    )?.value ?? {}) as { receiptRetentionDays?: unknown };

    const state = this.parseState(rows);

    const max = maxReceiptRetentionDays();

    const receiptRetentionDays = Math.min(
      validDays(settings.receiptRetentionDays) ?? defaultReceiptRetentionDays(),
      max,
    );

    const deletedBefore = state.receiptsDeletedBefore
      ? new Date(state.receiptsDeletedBefore)
      : null;

    const value: ReceiptRetentionSettings = {
      receiptRetentionDays,
      countRetentionDays: max,
      receiptsDeletedBefore:
        deletedBefore && !Number.isNaN(deletedBefore.getTime())
          ? deletedBefore
          : null,
    };

    cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };

    return value;
  }

  /** What the super admin console shows. */
  async getAdminView() {
    const [settings, state] = await Promise.all([
      this.getSettings({ fresh: true }),
      this.getState(),
    ]);

    return {
      receiptRetentionDays: settings.receiptRetentionDays,
      minimumDays: MIN_RECEIPT_RETENTION_DAYS,
      maximumDays: settings.countRetentionDays,
      countRetentionDays: settings.countRetentionDays,
      receiptsDeletedBefore: settings.receiptsDeletedBefore,
      uploadCutoff: this.uploadCutoff(settings),
      lastRun: state.lastRun ?? null,
    };
  }

  async updateReceiptRetentionDays(days: number, updatedBy: string) {
    const value = { receiptRetentionDays: days } as Prisma.InputJsonValue;

    await this.db.appSetting.upsert({
      where: { key: RECEIPT_RETENTION_SETTINGS_KEY },
      create: { key: RECEIPT_RETENTION_SETTINGS_KEY, value, updatedBy },
      update: { value, updatedBy },
    });

    cache = null;

    return this.getAdminView();
  }

  /**
   * Receipts before this instant are refused on upload: today plus the
   * previous `receiptRetentionDays` IST days, and never before what has
   * already been deleted.
   */
  uploadCutoff(settings: ReceiptRetentionSettings, now = new Date()) {
    const cutoff = this.retentionCutoff(settings.receiptRetentionDays, now);

    return settings.receiptsDeletedBefore &&
      settings.receiptsDeletedBefore > cutoff
      ? settings.receiptsDeletedBefore
      : cutoff;
  }

  retentionCutoff(days: number, now = new Date()) {
    return startOfIstDay(addDays(now, -days));
  }

  async getState(): Promise<ReceiptRetentionState> {
    const rows = await this.db.appSetting.findMany({
      where: { key: RECEIPT_RETENTION_STATE_KEY },
    });

    return this.parseState(rows);
  }

  /** Merges into the job's state row. */
  async updateState(patch: ReceiptRetentionState) {
    const current = await this.getState();

    const value = { ...current, ...patch } as unknown as Prisma.InputJsonValue;

    await this.db.appSetting.upsert({
      where: { key: RECEIPT_RETENTION_STATE_KEY },
      create: { key: RECEIPT_RETENTION_STATE_KEY, value, updatedBy: "system" },
      update: { value, updatedBy: "system" },
    });

    cache = null;
  }

  private parseState(rows: { key: string; value: Prisma.JsonValue }[]) {
    const value = rows.find(
      (row) => row.key === RECEIPT_RETENTION_STATE_KEY,
    )?.value;

    return (
      value && typeof value === "object" && !Array.isArray(value) ? value : {}
    ) as ReceiptRetentionState;
  }
}
