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

  // CSP plans: machines bought (per-machine pricing). Ignored for BC plans.
  machineCount?: number;

  ownerType: SubscriptionOwnerType;

  ownerId: string;
}

export interface ValidateQuotaInput {
  ownerType: SubscriptionOwnerType;
  ownerId: string;

  requested: {
    csps?: number;
    kos?: number;
    machines?: number;
  };
}

export interface ValidateMachineLimitInput {
  ownerType: SubscriptionOwnerType;
  ownerId: string;
  requestedMachines: number;
}
