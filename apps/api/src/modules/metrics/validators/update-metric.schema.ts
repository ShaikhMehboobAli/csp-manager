import { z } from "zod";

export const updateMetricSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),

  category: z
    .enum(["SOCIAL_SECURITY", "TRANSACTION", "VISIT", "MANUAL", "OTHER"])
    .optional(),

  source: z.enum(["RECEIPT", "MANUAL"]).optional(),

  inputType: z.enum(["COUNT", "NUMBER", "BOOLEAN"]).optional(),

  description: z.string().trim().max(500).optional(),
});
