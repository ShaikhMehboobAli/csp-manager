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

  bcId?: string;

  planId: string;

  billingCycle: BillingCycle;

  machineCount: number;

  amount: number;

  taxAmount: number;

  totalAmount: number;

  paymentMethod: PaymentMethod;

  paymentProvider: PaymentProvider;

  status: PaymentStatus;

  currency: string;
}
