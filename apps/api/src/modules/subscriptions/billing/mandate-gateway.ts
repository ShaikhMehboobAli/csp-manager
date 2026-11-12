import { randomUUID } from "node:crypto";

import { env } from "../../../config/env";
import { RazorpayClient, razorpayEnabled, toPaise } from "../../../core/services/razorpay.client";
import { Logger } from "../../../core/utils/logger";
import { MandateProvider, MandateStatus } from "../../../generated/prisma/enums";

export type ChargeResult =
  | { status: "SUCCESS"; gatewayTransactionId: string }
  | { status: "FAILED"; failureReason: string; retryable: boolean }
  // The gateway answers later (webhook). `transactionReference` = its order id.
  | { status: "PENDING"; transactionReference?: string; gatewayPaymentId?: string };

/** How renewals are timed for a gateway. */
export type RenewalPolicy = {
  /** Start charging this long before the end date. */
  leadHours: number;
  /** A charge with no answer after this counts as a failed attempt. */
  pendingTimeoutMinutes: number;
  maxAttempts: number;
  retryMinutes: number;
};

export type MandateCustomer = { name: string | null; email: string | null; contact: string | null };

export type MandateRef = {
  providerMandateId: string | null;
  providerCustomerId: string | null;
  maxAmount?: { toString(): string } | null;
};

export interface MandateGateway {
  readonly provider: MandateProvider;
  readonly policy: RenewalPolicy;

  /**
   * Registers a monthly UPI autopay mandate. `registrationPaymentId`: the
   * purchase payment that already asked the customer to approve it (Razorpay
   * registers the mandate with the first payment); without one the customer
   * gets an approval link (`authUrl`).
   */
  createMandate(input: {
    subscriptionId: string;
    ownerId: string;
    amount: number;
    startAt: Date;
    endAt: Date;
    registrationPaymentId?: string | null;
    customer: MandateCustomer;
  }): Promise<{
    providerMandateId: string | null;
    providerCustomerId: string | null;
    providerRegistrationId: string | null;
    status: MandateStatus;
    authUrl: string | null;
    maxAmount: number | null;
  }>;

  /** Charges one month on an active mandate. */
  charge(input: {
    mandate: MandateRef;
    paymentId: string;
    paymentNumber: string;
    subscriptionId: string;
    amount: number;
    customer: MandateCustomer;
  }): Promise<ChargeResult>;

  cancel(mandate: MandateRef): Promise<void>;

  /** New monthly amount after an upgrade. `applied: false` = the customer must approve a new mandate. */
  updateAmount(mandate: MandateRef, amount: number): Promise<{ applied: boolean }>;
}

/**
 * Development stand-in (no Razorpay keys). Mandates are active at once; a
 * charge returns DEV_MANDATE_RESULT (SUCCESS | FAILED | PENDING, default
 * SUCCESS) so the renewal, retry and lapse paths can be tested.
 */
class ManualMandateGateway implements MandateGateway {
  readonly provider = MandateProvider.MANUAL;

  // Charged on the end date, retried twice 15 minutes apart.
  readonly policy: RenewalPolicy = { leadHours: 0, pendingTimeoutMinutes: 30, maxAttempts: 3, retryMinutes: 15 };

  async createMandate() {
    return {
      providerMandateId: `dev_mandate_${randomUUID()}`,
      providerCustomerId: null,
      providerRegistrationId: null,
      status: MandateStatus.ACTIVE,
      authUrl: null,
      maxAmount: null,
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

/**
 * Razorpay UPI AutoPay (recurring payments, UPI Intent).
 *
 * - Registration: the CSP's purchase order carries a `token` block, so paying
 *   it also approves the mandate; otherwise a registration link (₹1) is sent.
 *   The token id comes from the payment; `token.confirmed` activates it.
 * - Renewal: an order + POST /payments/create/recurring. Razorpay sends the
 *   pre-debit notice at once, debits ~25 h later and retries up to 3 times
 *   itself; the answer arrives by webhook (payment.captured / payment.failed),
 *   possibly days later. So renewals start 48 h before the end date.
 */
class RazorpayMandateGateway implements MandateGateway {
  readonly provider = MandateProvider.RAZORPAY;

  readonly policy: RenewalPolicy = {
    leadHours: 48,
    // Razorpay may take up to ~5 days to settle a UPI debit with its retries.
    pendingTimeoutMinutes: 6 * 24 * 60,
    // Our attempts only repeat when Razorpay refused to start the charge.
    maxAttempts: 3,
    retryMinutes: 60,
  };

  private readonly client = new RazorpayClient();

  async createMandate(input: Parameters<MandateGateway["createMandate"]>[0]) {
    const maxAmount = Math.max(env.razorpayMandateMaxAmount, Math.ceil(input.amount));

    if (input.registrationPaymentId) {
      const payment = await this.client.fetchPayment(input.registrationPaymentId);

      if (payment.token_id) {
        return {
          providerMandateId: payment.token_id,
          providerCustomerId: payment.customer_id ?? null,
          providerRegistrationId: payment.order_id,
          // Captured = the customer approved the mandate with this payment
          // (token.confirmed, when the account gets it, confirms it again).
          status: payment.status === "captured" ? MandateStatus.ACTIVE : MandateStatus.PENDING,
          authUrl: null,
          maxAmount,
        };
      }
    }

    const { name, email, contact } = input.customer;

    if (!name || !email || !contact) {
      throw new Error("The account needs a name, email and mobile number for UPI AutoPay.");
    }

    const customer = await this.client.createCustomer({ name, email, contact, notes: { ownerId: input.ownerId } });
    const link = await this.client.createUpiRegistrationLink({
      customer: { name, email, contact },
      maxAmountPaise: toPaise(maxAmount),
      expireAt: input.endAt,
      receipt: `mandate-${input.subscriptionId}`,
      description: "CSP Manager monthly plan - UPI AutoPay",
      notes: { subscriptionId: input.subscriptionId, ownerId: input.ownerId },
    });

    return {
      providerMandateId: null,
      providerCustomerId: customer.id,
      providerRegistrationId: link.id,
      status: MandateStatus.PENDING,
      authUrl: link.short_url,
      maxAmount,
    };
  }

  async charge(input: Parameters<MandateGateway["charge"]>[0]): Promise<ChargeResult> {
    const { providerMandateId: tokenId, providerCustomerId: customerId } = input.mandate;

    if (!tokenId || !customerId) {
      return { status: "FAILED", failureReason: "The UPI mandate isn't approved yet.", retryable: false };
    }

    if (!input.customer.email || !input.customer.contact) {
      return { status: "FAILED", failureReason: "The account has no email or mobile number for the UPI debit.", retryable: false };
    }

    const notes = { paymentId: input.paymentId, subscriptionId: input.subscriptionId, purpose: "RENEWAL" };

    try {
      const order = await this.client.createOrder({ amountPaise: toPaise(input.amount), receipt: input.paymentNumber, notes });
      const created = await this.client.createRecurringPayment({
        orderId: order.id,
        customerId,
        tokenId,
        amountPaise: toPaise(input.amount),
        email: input.customer.email,
        contact: input.customer.contact,
        description: "CSP Manager monthly renewal",
        notes,
      });

      return { status: "PENDING", transactionReference: order.id, gatewayPaymentId: created.razorpay_payment_id };
    } catch (error) {
      return { status: "FAILED", failureReason: (error as Error).message.slice(0, 300), retryable: true };
    }
  }

  async cancel(mandate: MandateRef) {
    if (!mandate.providerMandateId || !mandate.providerCustomerId) {
      return;
    }

    try {
      await this.client.cancelToken(mandate.providerCustomerId, mandate.providerMandateId);
    } catch (error) {
      // Already cancelled / rejected in the UPI app: nothing left to stop.
      Logger.warn(`[Razorpay] cancel token ${mandate.providerMandateId}: ${(error as Error).message}`);
    }
  }

  async updateAmount(mandate: MandateRef, amount: number) {
    // A UPI token can't be changed; it can debit up to its max amount.
    return { applied: mandate.maxAmount ? amount <= Number(mandate.maxAmount.toString()) : false };
  }
}

const manual = new ManualMandateGateway();
let razorpay: RazorpayMandateGateway | null = null;

/**
 * The gateway for a mandate (`provider`), or for new mandates (none given):
 * Razorpay when its keys are set, else the dev stand-in (refused in
 * production unless ALLOW_MANUAL_MANDATES=true).
 */
export function getMandateGateway(provider?: MandateProvider): MandateGateway {
  if (provider === MandateProvider.MANUAL) {
    return manual;
  }

  if (provider === MandateProvider.RAZORPAY || razorpayEnabled()) {
    razorpay ??= new RazorpayMandateGateway();

    return razorpay;
  }

  if (env.nodeEnv === "production" && process.env.ALLOW_MANUAL_MANDATES !== "true") {
    throw new Error("No mandate gateway configured for production (set the Razorpay keys).");
  }

  return manual;
}
