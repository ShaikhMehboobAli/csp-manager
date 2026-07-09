import {
  BillingCycle,
  PlanOwnerType,
  //   SubscriptionType,
} from "../../../generated/prisma/enums";

export interface GetPlansInput {
  ownerType: PlanOwnerType;
}

export interface CreateSubscriptionInput {
  agentId: string;
  planId: string;
  billingCycle: BillingCycle;
  //   subscriptionType: SubscriptionType;
}
