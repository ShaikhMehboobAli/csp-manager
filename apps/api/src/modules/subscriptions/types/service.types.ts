import {
  BillingCycle,
  SubscriptionOwnerType,
} from "../../../generated/prisma/enums";

export interface CreatePaidSubscriptionInput {
  agentId: string;
  bcId?: string;

  planId: string;

  billingCycle: BillingCycle;

  paymentId: string;
  ownerType: SubscriptionOwnerType;

  ownerId: string;
}
