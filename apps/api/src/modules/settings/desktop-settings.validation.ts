import { z } from "zod";

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
