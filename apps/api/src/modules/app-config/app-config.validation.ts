import { z } from "zod";

const version = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+){0,3}$/, "Use a version like 1.4.0.");

const text = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const url = z.string().trim().url("Use a full https:// link.").max(500).nullable().optional();

const platform = z
  .object({ minVersion: version.nullable().optional(), latestVersion: version.nullable().optional(), updateUrl: url })
  .optional();

export const appConfigQuerySchema = z.object({
  platform: z.enum(["android", "ios"]).optional(),
  version: version.optional(),
});

export const updateAppConfigSchema = z
  .object({
    support: z
      .object({ phone: text(20), whatsapp: text(20), email: z.string().trim().email().nullable().optional(), hours: text(100) })
      .optional(),
    links: z.object({ terms: url, privacy: url }).optional(),
    android: platform,
    ios: platform,
    message: z.string().trim().max(300).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), "Send at least one setting.");
