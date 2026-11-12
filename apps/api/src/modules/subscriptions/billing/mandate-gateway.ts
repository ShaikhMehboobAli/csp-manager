import { randomUUID } from "node:crypto";

import { env } from "../../../config/env";
import { MandateProvider, MandateStatus } from "../../../generated/prisma/enums";

export type ChargeResult =
  | { status: "SUCCESS"; gatewayTransactionId: string }
  | { status: "FAILED"; failureReason: string; retryable: boolean }
  // The gateway answers later (webhook POST /payments/mandates/webhook).
  | { status: "PENDING" };

export interface MandateGateway {
  readonly provider: MandateProvider;

  /** Registers a monthly UPI autopay mandate (customer approves it in the UPI app). */
  createMandate(input: {
    subscriptionId: string;
    ownerId: string;
    amount: number;
    startAt: Date;
    endAt: Date;
  }): Promise<{
    providerMandateId: string | null;
    status: MandateStatus;
    authUrl: string | null;
  }>;

  /** Charges one month on an active mandate. */
  charge(input: {
    providerMandateId: string | null;
    paymentId: string;
    amount: number;
  }): Promise<ChargeResult>;

  cancel(providerMandateId: string | null): Promise<void>;

  /** New monthly amount after an upgrade. `applied: false` = the customer must re-approve. */
  updateAmount(providerMandateId: string | null, amount: number): Promise<{ applied: boolean }>;
}

/**
 * Development stand-in until Razorpay is integrated (pre-production checklist
 * 1.x). Mandates are active at once; a charge returns DEV_MANDATE_RESULT
 * (SUCCESS | FAILED | PENDING, default SUCCESS) so the renewal, retry and
 * lapse paths can be tested.
 */
class ManualMandateGateway implements MandateGateway {
  readonly provider = MandateProvider.MANUAL;

  async createMandate() {
    return {
      providerMandateId: `dev_mandate_${randomUUID()}`,
      status: MandateStatus.ACTIVE,
      authUrl: null,
    };
  }

  async charge(): Promise<ChargeResult> {
    const result = (process.env.DEV_MANDATE_RESULT ?? "SUCCESS").toUpperCase();

    if (result === "FAILED") {
      return { status: "FAILED", failureReason: "Insufficient balance (dev).", retryable: true };
    }

    if (result === "PENDING") {
      return { status: "PENDING" };
    }

    return { status: "SUCCESS", gatewayTransactionId: `dev_charge_${randomUUID()}` };
  }

  async cancel() {}

  async updateAmount() {
    return { applied: true };
  }
}

let gateway: MandateGateway | null = null;

export function getMandateGateway(): MandateGateway {
  if (gateway) {
    return gateway;
  }

  if (env.nodeEnv === "production" && process.env.ALLOW_MANUAL_MANDATES !== "true") {
    // Razorpay UPI autopay is not integrated yet (pre-production checklist).
    throw new Error("No mandate gateway configured for production.");
  }

  gateway = new ManualMandateGateway();

  return gateway;
}
