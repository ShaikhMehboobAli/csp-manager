import { z } from "zod";

const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be in YYYY-MM format.");

export const commissionSummarySchema = z.object({
  period: z.enum(["TODAY", "WEEK", "MONTH"]).default("MONTH"),
  // A whole month (the CSP earns monthly); overrides period.
  month: month.optional(),
  agentId: z.string().trim().min(1).optional(),
});

export const commissionMonthsSchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  count: z.coerce.number().int().min(1).max(12).default(12),
});

export const commissionRatesSchema = z.object({
  agentId: z.string().trim().min(1).optional(),
});

const money = z.number({ error: "Must be a number." }).finite().min(0, "Can't be negative.");

const slabSchema = z
  .object({
    from: money,
    to: money.nullable().default(null),
    type: z.enum(["FLAT", "PERCENT"]),
    amount: money.optional(),
    percent: z.number().finite().min(0).max(100, "percent can't be more than 100.").optional(),
  })
  .strict();

export const setRateSchema = z
  .object({
    serviceCode: z.string().trim().min(1, "serviceCode is required."),
    scope: z.enum(["DEFAULT", "BC", "CSP"]),
    scopeId: z.string().trim().optional(),
    type: z.enum(["FLAT", "PERCENT", "SLAB", "INHERIT"]),
    amount: money.optional(),
    percent: z.number().finite().min(0).max(100, "percent can't be more than 100.").optional(),
    minAmount: money.optional(),
    maxAmount: money.optional(),
    // SLAB: amount bands sorted by `from` (`to` exclusive, null = no upper limit).
    slabs: z.array(slabSchema).max(20, "At most 20 slabs.").optional(),
    effectiveFrom: z.coerce.date().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const rateScopeQuerySchema = z.object({
  scope: z.enum(["DEFAULT", "BC", "CSP"]).default("DEFAULT"),
  scopeId: z.string().trim().default(""),
});

export const rateHistoryQuerySchema = z.object({
  serviceCode: z.string().trim().optional(),
  scope: z.enum(["DEFAULT", "BC", "CSP"]).optional(),
  scopeId: z.string().trim().optional(),
});

export const updateServiceSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to change." });
