import { z } from "zod";

export const updateMetricValueSchema = z.object({
  value: z.number().min(0),
});
