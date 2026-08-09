import { z } from "zod";

export const updateMachineSchema = z.object({
  machineName: z.string().trim().min(1).max(100).optional(),

  watcherEnabled: z.boolean().optional(),
});
