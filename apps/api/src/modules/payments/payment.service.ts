import {
  BillingCycle,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  SubscriptionOwnerType,
} from "../../generated/prisma/enums";

import { withTransaction, withReadOnly } from "../../core/database/transaction";

import { createCodeGeneratorService } from "../../core/services/service.factory";

import { BadRequestError } from "../../core/errors/BadRequestError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { ConflictError } from "../../core/errors/ConflictError";

import PaymentRepository from "./payment.repository";

import { PrismaDb } from "../../core/database/prisma.types";

import {
  CreatePaymentOrderInput,
  VerifyPaymentInput,
} from "./types/service.types";
import SubscriptionService from "../subscriptions/subscription.service";
import { Payment } from "../../generated/prisma/client";
import { PaymentWebhookDto } from "./validations/webhook-payment.validation";
import ActivationService from "../activations/activation.service";
import prisma from "../../config/prisma";
import BillingSettingsService from "../settings/billing-settings.service";
import SubscriptionBillingService from "../subscriptions/billing/subscription-billing.service";
import { PaymentPurpose } from "../../generated/prisma/enums";
import { env } from "../../config/env";
import {
  RazorpayClient,
  RazorpayPayment,
  razorpayEnabled,
  toPaise,
  verifyCheckoutSignature,
} from "../../core/services/razorpay.client";
import { ownerContact } from "../subscriptions/billing/subscription-billing.service";
import { MANDATE_YEARS } from "../subscriptions/billing/billing.constants";

type GatewayDetails = { orderId?: string; customerId?: string | null; recurring?: boolean };

/** What the app passes to Razorpay Checkout for a pending Razorpay payment (null otherwise). */
async function checkoutFor(db: PrismaDb, payment: Payment) {
  if (payment.paymentProvider !== PaymentProvider.RAZORPAY || !payment.transactionReference) {
    return null;
  }

  const details = (payment.gatewayResponse ?? {}) as GatewayDetails;
  const [contact, plan] = await Promise.all([
    ownerContact(db, payment.ownerId),
    db.plan.findUnique({ where: { id: payment.planId }, select: { name: true } }),
  ]);

  return {
    keyId: env.razorpayKeyId,
    orderId: payment.transactionReference,
    amount: toPaise(payment.totalAmount.toString()),
    currency: "INR",
    name: "CSP Manager",
    description: `${plan?.name ?? "Plan"} (${payment.paymentNumber})`.slice(0, 50),
    // CSP monthly purchase: paying also approves UPI AutoPay (UPI only).
    recurring: details.recurring ? "1" : null,
    customerId: details.customerId ?? null,
    prefill: { name: contact.name, email: contact.email, contact: contact.contact },
    notes: { paymentId: payment.id },
  };
}

export default class PaymentService {
  async createOrder(data: CreatePaymentOrderInput) {
    return withTransaction(async (tx) => {
      const repository = new PaymentRepository(tx);

      // CSP plans are priced per machine; BC plans have a fixed machine limit.
      if (
        data.ownerType !== SubscriptionOwnerType.CSP &&
        data.machineCount !== undefined &&
        data.machineCount !== 1
      ) {
        throw new BadRequestError(
          "Machine count can only be chosen for CSP plans.",
        );
      }

      const machineCount =
        data.ownerType === SubscriptionOwnerType.CSP
          ? (data.machineCount ?? 1)
          : 1;

      await repository.lockOwner(data.ownerId);

      // A retried request with the same Idempotency-Key gets the payment the
      // first request created, whatever its status.
      if (data.idempotencyKey) {
        const existing = await repository.findByIdempotencyKey(
          data.ownerId,
          data.idempotencyKey,
        );

        if (existing) {
          if (
            existing.planId !== data.planId ||
            existing.billingCycle !== data.billingCycle ||
            existing.machineCount !== machineCount
          ) {
            throw new ConflictError(
              "This Idempotency-Key was already used for a different order.",
            );
          }

          return {
            success: true,
            message: "Payment order already exists for this Idempotency-Key.",
            data: { ...existing, checkout: await checkoutFor(tx, existing) },
          };
        }
      }

      const codeGenerator = createCodeGeneratorService(tx);

      const plan = await repository.findPlanWithPricing(data.planId);

      if (!plan || !plan.isActive || plan.isDeleted) {
        throw new NotFoundError("Plan not found.");
      }

      // Plan owner types (BC / CSP) share values with subscription owner types.
      if (plan.ownerType !== data.ownerType) {
        throw new BadRequestError("This plan is not available for your account.");
      }

      const pricing = plan.pricings.find(
        (pricing) => pricing.billingCycle === data.billingCycle,
      );

      if (!pricing) {
        throw new BadRequestError("Selected billing cycle is not available.");
      }

      // CSP: a running subscription can only be upgraded (difference only,
      // first 12 days); otherwise this is a new purchase. Throws on a
      // downgrade, fewer machines, the same terms or a closed window.
      const quote = await new SubscriptionBillingService(tx).quote({
        ownerType: data.ownerType,
        ownerId: data.ownerId,
        plan,
        billingCycle: data.billingCycle,
        unitPrice: pricing.price,
        machineCount,
      });

      if (
        quote.purpose === PaymentPurpose.UPGRADE &&
        data.billingCycle !== BillingCycle.MONTHLY
      ) {
        throw new BadRequestError("Upgrades are billed on the monthly plan.");
      }

      // The same open order is returned again, unless it was priced for a
      // different situation (e.g. a purchase, now an upgrade): then it's
      // cancelled and a new one is opened.
      const pendingPayment = await repository.findPendingPayment(
        data.ownerType,
        data.ownerId,
        data.planId,
        data.billingCycle,
        machineCount,
      );

      if (pendingPayment) {
        const { amount: quoted } = await new BillingSettingsService(tx).withGst(
          Number(quote.amount),
        );

        const sameProvider =
          pendingPayment.paymentProvider === (razorpayEnabled() ? PaymentProvider.RAZORPAY : PaymentProvider.MANUAL);

        if (
          sameProvider &&
          pendingPayment.purpose === quote.purpose &&
          pendingPayment.amount.equals(quoted)
        ) {
          return {
            success: true,
            message: "Pending payment already exists.",
            data: {
              ...pendingPayment,
              breakdown: quote.breakdown,
              mandate: null,
              checkout: await checkoutFor(tx, pendingPayment),
            },
          };
        }

        await tx.payment.update({
          where: { id: pendingPayment.id },
          data: {
            status: PaymentStatus.CANCELLED,
            failureReason: "Replaced by a new order with an updated price.",
          },
        });
      }

      const paymentNumber = await codeGenerator.generatePaymentNumber();

      // GST is added on top of the plan price (subscriptions only).
      const { amount, taxAmount, totalAmount, gstPercent } =
        await new BillingSettingsService(tx).withGst(Number(quote.amount));

      const payment = await repository.createPayment({
        paymentNumber,

        ownerType: data.ownerType,

        ownerId: data.ownerId,

        bcId: data.bcId,

        planId: plan.id,

        billingCycle: data.billingCycle,

        machineCount,

        purpose: quote.purpose,

        previousPlanId: quote.previousPlanId ?? undefined,

        previousMachineCount: quote.previousMachineCount ?? undefined,

        subscriptionId: quote.subscriptionId ?? undefined,

        idempotencyKey: data.idempotencyKey,

        amount: amount.toNumber(),

        taxAmount: taxAmount.toNumber(),

        taxPercent: gstPercent,

        totalAmount: totalAmount.toNumber(),

        paymentMethod: PaymentMethod.MANUAL,

        paymentProvider: PaymentProvider.MANUAL,

        status: PaymentStatus.PENDING,

        currency: "INR",
      });

      const opened = razorpayEnabled()
        ? await this.openRazorpayOrder(tx, payment, data.ownerType === SubscriptionOwnerType.CSP && quote.purpose === PaymentPurpose.PURCHASE && data.billingCycle === BillingCycle.MONTHLY)
        : payment;

      return {
        success: true,
        message:
          quote.purpose === PaymentPurpose.UPGRADE
            ? "Upgrade order created: you pay only the difference. The plan's end date doesn't change."
            : "Payment order created successfully.",
        data: {
          ...opened,
          // Open Razorpay Checkout with this (null = dev stand-in: verify with gatewayTransactionId).
          checkout: await checkoutFor(tx, opened),
          // How the amount was worked out (UPGRADE only).
          breakdown: quote.breakdown,
          // CSP purchases set up a monthly UPI autopay mandate on success.
          mandate:
            data.ownerType === SubscriptionOwnerType.CSP &&
            quote.purpose === PaymentPurpose.PURCHASE
              ? { required: true, frequency: BillingCycle.MONTHLY, years: 25 }
              : null,
        },
      };
    });
  }

  /**
   * Creates the Razorpay order for a new payment. A CSP's monthly purchase
   * (up to the AutoPay limit) is a UPI order that also registers the monthly
   * mandate, so the CSP approves once.
   */
  private async openRazorpayOrder(db: PrismaDb, payment: Payment, registerMandate: boolean) {
    const client = new RazorpayClient();
    const total = Number(payment.totalAmount);
    const recurring = registerMandate && total <= env.razorpayMandateMaxAmount;
    let customerId: string | null = null;

    if (recurring) {
      const contact = await ownerContact(db, payment.ownerId);

      customerId = (await client.createCustomer({ ...contact, notes: { ownerId: payment.ownerId } })).id;
    }

    const expireAt = new Date();

    expireAt.setFullYear(expireAt.getFullYear() + MANDATE_YEARS);

    const order = await client.createOrder({
      amountPaise: toPaise(total),
      receipt: payment.paymentNumber,
      notes: { paymentId: payment.id, purpose: payment.purpose },
      ...(recurring &&
        customerId && {
          upiMandate: { customerId, maxAmountPaise: toPaise(Math.max(env.razorpayMandateMaxAmount, total)), expireAt },
        }),
    });

    return db.payment.update({
      where: { id: payment.id },
      data: {
        paymentProvider: PaymentProvider.RAZORPAY,
        paymentMethod: recurring ? PaymentMethod.UPI : PaymentMethod.RAZORPAY,
        transactionReference: order.id,
        gatewayResponse: { orderId: order.id, customerId, recurring },
      },
    });
  }

  /**
   * Razorpay told us (Checkout handler or webhook) about a payment on our
   * order: checks it belongs to the order and the full amount was captured.
   * Returns null when it's still being processed (authorized, not captured).
   */
  private assertGatewayPayment(payment: Payment, gateway: RazorpayPayment) {
    if (gateway.order_id !== payment.transactionReference) {
      throw new BadRequestError("This payment is for a different order.", "PAYMENT_ORDER_MISMATCH");
    }

    if (gateway.amount !== toPaise(payment.totalAmount.toString())) {
      throw new BadRequestError("The paid amount doesn't match the order.", "PAYMENT_AMOUNT_MISMATCH");
    }

    if (gateway.status === "failed") {
      throw new BadRequestError(gateway.error_description ?? "The payment failed. Please try again.", "PAYMENT_FAILED");
    }

    return gateway.status === "captured";
  }

  /** Webhook payment.captured / order.paid for a one-time payment (purchase, upgrade, BC). */
  async completeFromRazorpay(paymentId: string, gateway: RazorpayPayment, db: PrismaDb) {
    const repository = new PaymentRepository(db);

    await repository.lockPayment(paymentId);

    const payment = await repository.findPaymentById(paymentId);

    if (!payment || payment.status !== PaymentStatus.PENDING) {
      return;
    }

    if (this.assertGatewayPayment(payment, gateway)) {
      await this.completePayment(payment, gateway.id, gateway.order_id ?? undefined, db);
    }
  }

  private async completePayment(
    payment: Payment,
    gatewayTransactionId: string,
    transactionReference: string | undefined,
    tx: PrismaDb,
  ) {
    const repository = new PaymentRepository(tx);

    const usedBy = await repository.findByGatewayTransactionId(
      gatewayTransactionId,
    );

    if (usedBy && usedBy.id !== payment.id) {
      throw new ConflictError(
        "This gateway transaction is already linked to another payment.",
      );
    }

    if (payment.purpose === PaymentPurpose.UPGRADE) {
      const upgraded = await new SubscriptionBillingService(tx).applyUpgrade({
        id: payment.id,
        planId: payment.planId,
        machineCount: payment.machineCount,
        amount: payment.amount,
        previousPlanId: payment.previousPlanId,
        ownerId: payment.ownerId,
      });

      await repository.updatePaymentSuccess(
        payment.id,
        upgraded.id,
        gatewayTransactionId,
        transactionReference,
        await createCodeGeneratorService(tx).generateInvoiceNumber(),
      );

      return {
        success: true,
        message: "Upgrade paid. New machine slots are ready to assign.",
        data: { paymentId: payment.id, subscriptionId: upgraded.id },
      };
    }

    if (payment.purpose === PaymentPurpose.RENEWAL) {
      throw new BadRequestError("Renewals are charged by the UPI mandate, not verified here.");
    }

    const subscriptionService = new SubscriptionService(prisma);

    const created = await subscriptionService.createPaidSubscription(
      {
        agentId: payment.ownerId,

        bcId: payment.bcId ?? undefined,

        ownerType: payment.ownerType,

        ownerId: payment.ownerId,

        planId: payment.planId,

        billingCycle: payment.billingCycle,

        machineCount: payment.machineCount,

        paymentId: payment.id,
      },
      tx,
    );

    // CSP: price, upgrade window and the monthly UPI mandate.
    const subscription = await new SubscriptionBillingService(
      tx,
    ).setUpNewSubscription(
      created,
      payment.machineCount > 0
        ? payment.amount.dividedBy(payment.machineCount)
        : payment.amount,
      // Razorpay: this payment also registered UPI AutoPay (token on it).
      payment.paymentProvider === PaymentProvider.RAZORPAY ? gatewayTransactionId : null,
    );

    const activationService = new ActivationService();

    await activationService.generateActivations(
      {
        subscriptionId: subscription.id,
        machineLimit: subscription.machineLimit,
        expiresAt: subscription.endDate,
      },
      tx,
    );

    await repository.updatePaymentSuccess(
      payment.id,
      subscription.id,
      gatewayTransactionId,
      transactionReference,
      await createCodeGeneratorService(tx).generateInvoiceNumber(),
    );

    return {
      success: true,
      message: "Payment verified successfully.",
      data: {
        paymentId: payment.id,
        subscriptionId: subscription.id,
      },
    };
  }

  async verifyPayment(data: VerifyPaymentInput) {
    return withTransaction(async (tx) => {
      const repository = new PaymentRepository(tx);

      await repository.lockPayment(data.paymentId);

      const payment = await repository.findPaymentById(data.paymentId);

      // Users can only verify their own payments.
      if (!payment || payment.ownerId !== data.agentId) {
        throw new NotFoundError("Payment not found.");
      }

      if (payment.status === PaymentStatus.SUCCESS) {
        // A retry after a lost response (slow network, app killed) with the
        // same gateway transaction gets the original result, not an error.
        if (payment.gatewayTransactionId === (data.razorpayPaymentId ?? data.gatewayTransactionId)) {
          return {
            success: true,
            message: "Payment already verified.",
            data: {
              paymentId: payment.id,
              subscriptionId: payment.subscriptionId,
            },
          };
        }

        throw new BadRequestError("Payment is already verified.");
      }

      if (payment.status !== PaymentStatus.PENDING) {
        throw new BadRequestError("Payment is no longer pending.");
      }

      if (payment.paymentProvider === PaymentProvider.RAZORPAY) {
        if (!data.razorpayPaymentId || !data.razorpaySignature) {
          throw new BadRequestError("Send razorpayOrderId, razorpayPaymentId and razorpaySignature from Checkout.");
        }

        // Signed over OUR order id, never the one the client sends.
        if (
          !payment.transactionReference ||
          (data.razorpayOrderId && data.razorpayOrderId !== payment.transactionReference) ||
          !verifyCheckoutSignature(payment.transactionReference, data.razorpayPaymentId, data.razorpaySignature)
        ) {
          throw new BadRequestError("The payment signature is invalid.", "PAYMENT_SIGNATURE_INVALID");
        }

        const gateway = await new RazorpayClient().fetchPayment(data.razorpayPaymentId);

        if (!this.assertGatewayPayment(payment, gateway)) {
          // Authorized but not captured yet: the webhook completes it.
          return {
            success: true,
            message: "Payment received; we're confirming it with the bank. This takes a minute.",
            data: { paymentId: payment.id, subscriptionId: null, status: "PROCESSING" as const },
          };
        }

        return this.completePayment(payment, gateway.id, payment.transactionReference, tx);
      }

      if (!data.gatewayTransactionId) {
        throw new BadRequestError("Send gatewayTransactionId.");
      }

      return this.completePayment(
        payment,
        data.gatewayTransactionId,
        data.transactionReference,
        tx,
      );
    });
  }

  async getPaymentHistory(agentId: string) {
    return withReadOnly(async (tx) => {
      const repository = new PaymentRepository(tx);

      const payments = await repository.findPaymentHistory(agentId);

      return {
        success: true,
        message: "Payment history fetched successfully.",
        data: payments,
      };
    });
  }

  async getPaymentDetails(paymentId: string, agentId: string) {
    return withReadOnly(async (tx) => {
      const repository = new PaymentRepository(tx);

      const payment = await repository.findPaymentDetails(paymentId, agentId);

      if (!payment) {
        throw new NotFoundError("Payment not found.");
      }

      return {
        success: true,
        message: "Payment details fetched successfully.",
        data: payment,
      };
    });
  }

  async webhook(data: PaymentWebhookDto) {
    return withTransaction(async (tx) => {
      const repository = new PaymentRepository(tx);

      await repository.lockPayment(data.paymentId);

      const payment = await repository.findPaymentByIdForWebhook(
        data.paymentId,
      );

      if (!payment) {
        throw new NotFoundError("Payment not found.");
      }

      if (payment.status === PaymentStatus.SUCCESS) {
        return {
          success: true,
          message: "Payment already processed.",
        };
      }

      if (payment.status !== PaymentStatus.PENDING) {
        throw new BadRequestError("Payment is no longer pending.");
      }

      return this.completePayment(
        payment,
        data.gatewayTransactionId,
        data.transactionReference,
        tx,
      );
    });
  }
}
