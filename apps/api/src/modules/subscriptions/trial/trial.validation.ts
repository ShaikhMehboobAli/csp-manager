import { z } from "zod";

import { MAX_TRIAL_DAYS, MAX_TRIAL_MACHINES } from "./trial-settings.service";

export const updateTrialSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    days: z.number().int().min(1).max(MAX_TRIAL_DAYS).optional(),
    machineCount: z.number().int().min(1).max(MAX_TRIAL_MACHINES).optional(),
    cspPlanCode: z.string().trim().min(1).optional(),
    bcPlanCode: z.string().trim().min(1).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), "Send at least one setting.");

export const extendTrialSchema = z
  .object({
    extendDays: z.number().int().min(1).max(MAX_TRIAL_DAYS).optional(),
    machineCount: z.number().int().min(1).max(MAX_TRIAL_MACHINES).optional(),
  })
  .refine((data) => data.extendDays !== undefined || data.machineCount !== undefined, "Send extendDays and / or machineCount.");

const page = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const listTrialsQuerySchema = z.object({
  status: z.enum(["ACTIVE", "EXPIRED"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  ...page,
});

export const listTrialUsagesQuerySchema = z.object({
  ownerId: z.string().trim().min(1).optional(),
  value: z.string().trim().min(1).max(200).optional(),
  ...page,
});
