import { z } from "zod";

export const createMetricSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(
      /^[A-Z0-9_]+$/,
      "Code must contain only uppercase letters, numbers, and underscores.",
    ),

  name: z.string().trim().min(2).max(100),

  category: z.enum([
    "SOCIAL_SECURITY",
    "TRANSACTION",
    "VISIT",
    "MANUAL",
    "OTHER",
  ]),

  source: z.enum(["RECEIPT", "MANUAL"]),

  inputType: z.enum(["COUNT", "NUMBER", "BOOLEAN"]).optional(),

  description: z.string().trim().max(500).optional(),
});
