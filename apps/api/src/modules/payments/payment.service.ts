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
            data: existing,
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

        if (
          pendingPayment.purpose === quote.purpose &&
          pendingPayment.amount.equals(quoted)
        ) {
          return {
            success: true,
            message: "Pending payment already exists.",
            data: { ...pendingPayment, breakdown: quote.breakdown, mandate: null },
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

      return {
        success: true,
        message:
          quote.purpose === PaymentPurpose.UPGRADE
            ? "Upgrade order created: you pay only the difference. The plan's end date doesn't change."
            : "Payment order created successfully.",
        data: {
          ...payment,
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
        if (payment.gatewayTransactionId === data.gatewayTransactionId) {
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
