import {
  BillingCycle,
  SubscriptionOwnerType,
} from "../../../generated/prisma/enums";

export interface CreatePaymentOrderInput {
  agentId: string;

  planId: string;

  billingCycle: BillingCycle;

  machineCount?: number;

  ownerType: SubscriptionOwnerType;

  ownerId: string;

  bcId?: string;
}

export interface VerifyPaymentInput {
  agentId: string;
  paymentId: string;

  gatewayTransactionId: string;

  transactionReference?: string;
}
