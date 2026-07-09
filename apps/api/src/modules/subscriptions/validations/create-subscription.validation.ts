import { z } from "zod";

import { BillingCycle } from "../../../generated/prisma/enums";

export const createSubscriptionSchema = z.object({
  planId: z.string().cuid(),

  billingCycle: z.nativeEnum(BillingCycle),
});

export type CreateSubscriptionDto = z.infer<typeof createSubscriptionSchema>;
