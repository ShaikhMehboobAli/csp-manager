import prisma from "../../config/prisma";
import { PrismaDb } from "../../core/database/prisma.types";

export const RECEIPT_FIELDS_SETTINGS_KEY = "receiptFields";

/**
 * Optional receipt fields the desktop may send, each switched on or off by
 * the super admin. The allowed list reaches the desktop in the heartbeat and
 * entitlements (`receiptFields.allowed`, saved in machineConfig.json); the
 * upload stores only allowed fields and drops the rest. Personal data is off
 * by default. Aadhaar is not a field at all.
 */
export const RECEIPT_FIELDS = {
  rrn: { label: "RRN", personal: false, default: true },
  stan: { label: "STAN", personal: false, default: true },
  terminalId: { label: "Terminal ID", personal: false, default: true },
  location: { label: "Location", personal: false, default: true },
  bankName: { label: "Bank name", personal: false, default: false },
  bankTransactionId: { label: "Bank transaction ID", personal: false, default: false },
  bankResponseCode: { label: "Bank response code", personal: false, default: false },
  bankResponseMessage: { label: "Bank response message", personal: false, default: false },
  balanceAfter: { label: "Balance after the transaction", personal: true, default: false },
  customerName: { label: "Customer name", personal: true, default: false },
  customerAccount: { label: "Customer account (masked)", personal: true, default: false },
} as const;

export type ReceiptField = keyof typeof RECEIPT_FIELDS;

export const RECEIPT_FIELD_NAMES = Object.keys(RECEIPT_FIELDS) as ReceiptField[];

const CACHE_TTL_MS = 60_000;

let cache: { value: Record<ReceiptField, boolean>; expiresAt: number } | null = null;

export default class ReceiptFieldsSettingsService {
  constructor(private readonly db: PrismaDb = prisma) {}

  /** Each field → allowed. Cached a minute (changes reach PCs within a heartbeat or two). */
  async getFields({ fresh = false } = {}) {
    if (!fresh && cache && cache.expiresAt > Date.now()) {
      return cache.value;
    }

    const row = await this.db.appSetting.findUnique({ where: { key: RECEIPT_FIELDS_SETTINGS_KEY } });
    const stored = (row?.value ?? {}) as Partial<Record<ReceiptField, unknown>>;

    const value = Object.fromEntries(
      RECEIPT_FIELD_NAMES.map((name) => [
        name,
        typeof stored[name] === "boolean" ? (stored[name] as boolean) : RECEIPT_FIELDS[name].default,
      ]),
    ) as Record<ReceiptField, boolean>;

    cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };

    return value;
  }

  async allowed() {
    const fields = await this.getFields();

    return RECEIPT_FIELD_NAMES.filter((name) => fields[name]);
  }

  async getAdminView() {
    const fields = await this.getFields({ fresh: true });

    return RECEIPT_FIELD_NAMES.map((name) => ({
      field: name,
      label: RECEIPT_FIELDS[name].label,
      personal: RECEIPT_FIELDS[name].personal,
      allowed: fields[name],
    }));
  }

  async update(change: Partial<Record<ReceiptField, boolean>>, updatedBy: string) {
    const current = await this.getFields({ fresh: true });
    const value = { ...current, ...change };

    await this.db.appSetting.upsert({
      where: { key: RECEIPT_FIELDS_SETTINGS_KEY },
      create: { key: RECEIPT_FIELDS_SETTINGS_KEY, value, updatedBy },
      update: { value, updatedBy },
    });

    cache = null;

    return this.getAdminView();
  }

  /** The receipt with the fields that aren't allowed taken out. */
  static strip<T extends Record<string, unknown>>(receipt: T, allowed: ReceiptField[]) {
    const kept = { ...receipt };

    for (const name of RECEIPT_FIELD_NAMES) {
      if (!allowed.includes(name)) {
        delete kept[name];
      }
    }

    return kept;
  }
}
