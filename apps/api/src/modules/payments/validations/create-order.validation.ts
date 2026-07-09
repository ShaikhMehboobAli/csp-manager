import { z } from "zod";

import { BillingCycle } from "../../../generated/prisma/enums";

export const createOrderSchema = z.object({
  planId: z.string().cuid(),

  billingCycle: z.nativeEnum(BillingCycle),
});

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
