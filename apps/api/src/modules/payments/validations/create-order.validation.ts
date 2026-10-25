import { z } from "zod";

import { BillingCycle } from "../../../generated/prisma/enums";

export const createOrderSchema = z.object({
  planId: z.string().cuid(),

  billingCycle: z.nativeEnum(BillingCycle),
  // CSP plans are per machine (default 1). Not allowed for BC plans.
  machineCount: z.number().int().min(1).max(100).optional(),
});

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
