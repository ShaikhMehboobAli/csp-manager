import { z } from "zod";

import { BillingCycle } from "../../../generated/prisma/enums";

export const updatePlanPricingSchema = z.object({
  billingCycle: z.nativeEnum(BillingCycle),

  price: z.number().positive().max(1_000_000),

  // Required when adding a billing cycle the plan doesn't have yet.
  durationDays: z.number().int().min(1).max(3660).optional(),

  isActive: z.boolean().optional(),
});

export type UpdatePlanPricingDto = z.infer<typeof updatePlanPricingSchema>;
