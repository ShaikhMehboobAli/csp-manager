import { z } from "zod";

import { ReceiptType, TransactionCategory } from "../../generated/prisma/enums";

export const dashboardSummarySchema = z
  .object({
    from: z.coerce.date().optional(),

    to: z.coerce.date().optional(),

    machineId: z.string().trim().optional(),

    receiptType: z.nativeEnum(ReceiptType).optional(),

    transactionCategory: z.nativeEnum(TransactionCategory).optional(),

    search: z.string().trim().optional(),
  })
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: "'from' date must be before 'to' date.",
    path: ["from"],
  });

export const dashboardAnalyticsSchema = dashboardSummarySchema.extend({
  groupBy: z.enum(["hour", "day", "week", "month", "year"]).default("day"),
});

export type DashboardSummaryQuery = z.infer<typeof dashboardSummarySchema>;

export type DashboardAnalyticsQuery = z.infer<typeof dashboardAnalyticsSchema>;
