import { z } from "zod";

export const createMetricValueSchema = z.object({
  metricId: z.string().min(1),

  agentId: z.string().min(1),

  date: z.coerce.date(),

  value: z.number().min(0),
});
