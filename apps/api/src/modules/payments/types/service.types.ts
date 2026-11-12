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

  // From the Idempotency-Key header.
  idempotencyKey?: string;
}

export interface VerifyPaymentInput {
  agentId: string;
  paymentId: string;

  /** Dev stand-in (no Razorpay keys). */
  gatewayTransactionId?: string;

  transactionReference?: string;

  /** From Razorpay Checkout's handler. */
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
}
