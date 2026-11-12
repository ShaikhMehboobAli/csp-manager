import { z } from "zod";

import { MAX_GRACE_DAYS } from "./billing-settings.service";
import {
  FIXED_RECEIPT_FIELDS,
  RECEIPT_FIELD_NAMES,
  ReceiptField,
} from "./receipt-fields-settings.service";

import { DESKTOP_SERVICE_CODES } from "./desktop-settings.constants";

// Only known service codes; a code that is left out keeps its current value.
const serviceSwitchesSchema = z.partialRecord(
  z.enum(DESKTOP_SERVICE_CODES),
  z.boolean(),
);

export const desktopControlsSchema = z
  .object({
    services: serviceSwitchesSchema.optional(),
    receiptCashDenominationConfirm: z.boolean().optional(),
  })
  .strict();

const versionSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+){1,3}$/, "Version must look like 1.0.0.");

export const updateDesktopSettingsSchema = desktopControlsSchema
  .extend({
    // null clears the value.
    minimumVersion: versionSchema.nullable().optional(),
    latestWatcherVersion: versionSchema.nullable().optional(),
    downloadUrl: z.url().nullable().optional(),
    portalUrl: z.url().nullable().optional(),
  })
  .strict();

// Per-machine override; null removes the machine's override entirely.
export const updateMachineDesktopControlsSchema = z
  .object({
    desktopControls: desktopControlsSchema.nullable(),
  })
  .strict();

export type DesktopControlsInput = z.infer<typeof desktopControlsSchema>;
export type UpdateDesktopSettingsInput = z.infer<
  typeof updateDesktopSettingsSchema
>;

export const updateReceiptRetentionSchema = z
  .object({
    receiptRetentionDays: z
      .number()
      .int("Receipt retention must be a whole number of days.")
      .min(15, "Receipt retention must be at least 15 days."),
  })
  .strict();

/** The selected extra receipt fields (multi-select); the defaults are always on. */
export const updateReceiptFieldsSchema = z
  .object({
    extra: z
      .array(z.string())
      .refine((names) => names.every((name) => RECEIPT_FIELD_NAMES.includes(name as never)), {
        message: `Unknown receipt field. Fields: ${RECEIPT_FIELD_NAMES.join(", ")}.`,
      })
      .refine((names) => !names.some((name) => FIXED_RECEIPT_FIELDS.includes(name as never)), {
        message: `${FIXED_RECEIPT_FIELDS.join(", ")} are always shown; send only the extra fields.`,
      })
      .transform((names) => [...new Set(names)] as ReceiptField[]),
  })
  .strict();

export const updateBillingSettingsSchema = z
  .object({
    graceDays: z
      .number()
      .int("Grace period must be a whole number of days.")
      .min(0, "Grace period can't be negative.")
      .max(MAX_GRACE_DAYS, `Grace period can be at most ${MAX_GRACE_DAYS} days.`)
      .optional(),
    gstPercent: z
      .number()
      .min(0, "GST can't be negative.")
      .max(28, "GST can be at most 28%.")
      .refine((value) => Number.isInteger(value * 100), { message: "GST can have at most 2 decimals." })
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to change." });
