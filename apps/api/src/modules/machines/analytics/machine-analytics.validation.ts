import { z } from "zod";

export const machineAnalyticsQuerySchema = z.object({
  from: z.coerce.date().optional(),

  to: z.coerce.date().optional(),

  groupBy: z.enum(["day", "week", "month"]).default("day"),
});

export type MachineAnalyticsQuery = z.infer<typeof machineAnalyticsQuerySchema>;
