import {
  BillingCycle,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  SubscriptionOwnerType,
} from "../../../generated/prisma/enums";

export interface CreatePaymentInput {
  paymentNumber: string;

  ownerType: SubscriptionOwnerType;

  ownerId: string;

  agentId: string;

  bcId?: string;

  planId: string;

  billingCycle: BillingCycle;

  amount: number;

  taxAmount: number;

  totalAmount: number;

  paymentMethod: PaymentMethod;

  paymentProvider: PaymentProvider;

  status: PaymentStatus;

  currency: string;
}
