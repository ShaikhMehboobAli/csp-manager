import prisma from "../../config/prisma";
import { PrismaDb } from "../../core/database/prisma.types";

export const RECEIPT_FIELDS_SETTINGS_KEY = "receiptFields";

/**
 * Receipt fields the desktop may send. The defaults (`fixed`) are always
 * allowed; the super admin picks extra ones from the rest (multi-select).
 * The allowed list reaches the desktop in the heartbeat and entitlements
 * (`receiptFields.allowed`, saved in machineConfig.json); the upload stores
 * only allowed fields and drops the rest. Aadhaar is not a field at all.
 * `slip` is the slip image (uploaded separately, see receipt slip upload).
 */
export const RECEIPT_FIELDS = {
  rrn: { label: "RRN", personal: false, fixed: true },
  stan: { label: "STAN", personal: false, fixed: false },
  terminalId: { label: "Terminal ID", personal: false, fixed: false },
  location: { label: "Location", personal: false, fixed: true },
  bankName: { label: "Bank name", personal: false, fixed: false },
  bankTransactionId: { label: "Bank transaction ID", personal: false, fixed: false },
  bankResponseCode: { label: "Bank response code", personal: false, fixed: false },
  bankResponseMessage: { label: "Bank response message", personal: false, fixed: false },
  balanceAfter: { label: "Balance after the transaction", personal: true, fixed: false },
  customerName: { label: "Customer name", personal: true, fixed: false },
  customerAccount: { label: "Customer account (masked)", personal: true, fixed: false },
  slip: { label: "Slip image", personal: true, fixed: false },
} as const;

export type ReceiptField = keyof typeof RECEIPT_FIELDS;

export const RECEIPT_FIELD_NAMES = Object.keys(RECEIPT_FIELDS) as ReceiptField[];

export const FIXED_RECEIPT_FIELDS = RECEIPT_FIELD_NAMES.filter((name) => RECEIPT_FIELDS[name].fixed);

export const EXTRA_RECEIPT_FIELDS = RECEIPT_FIELD_NAMES.filter((name) => !RECEIPT_FIELDS[name].fixed);

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
      RECEIPT_FIELD_NAMES.map((name) => [name, RECEIPT_FIELDS[name].fixed || stored[name] === true]),
    ) as Record<ReceiptField, boolean>;

    cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };

    return value;
  }

  async allowed() {
    const fields = await this.getFields();

    return RECEIPT_FIELD_NAMES.filter((name) => fields[name]);
  }

  /** Admin multi-select: fixed defaults, the extra options, and which extras are selected. */
  async getAdminView() {
    const fields = await this.getFields({ fresh: true });
    const describe = (name: ReceiptField) => ({
      field: name,
      label: RECEIPT_FIELDS[name].label,
      personal: RECEIPT_FIELDS[name].personal,
    });

    return {
      fixed: FIXED_RECEIPT_FIELDS.map(describe),
      options: EXTRA_RECEIPT_FIELDS.map(describe),
      selected: EXTRA_RECEIPT_FIELDS.filter((name) => fields[name]),
      allowed: RECEIPT_FIELD_NAMES.filter((name) => fields[name]),
    };
  }

  /** `extra`: the full list of selected extra fields (replaces the previous selection). */
  async update(extra: ReceiptField[], updatedBy: string) {
    const value = Object.fromEntries(
      RECEIPT_FIELD_NAMES.map((name) => [name, RECEIPT_FIELDS[name].fixed || extra.includes(name)]),
    );

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
