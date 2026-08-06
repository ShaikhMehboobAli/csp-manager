import { z } from "zod";

export const reportSummarySchema = z.object({
  from: z.coerce.date().optional(),

  to: z.coerce.date().optional(),

  cspAgentId: z.string().trim().optional(),

  period: z
    .enum(["TODAY", "YESTERDAY", "CURRENT_MONTH", "LAST_MONTH", "CUSTOM"])
    .default("TODAY"),
});

export type ReportSummaryQuery = z.infer<typeof reportSummarySchema>;
