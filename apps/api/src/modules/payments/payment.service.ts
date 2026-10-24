import {
  BillingCycle,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from "../../generated/prisma/enums";

import { withTransaction } from "../../core/database/transaction";

import { createCodeGeneratorService } from "../../core/services/service.factory";

import { BadRequestError } from "../../core/errors/BadRequestError";
import { NotFoundError } from "../../core/errors/NotFoundError";

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

export default class PaymentService {
  async createOrder(data: CreatePaymentOrderInput) {
    return withTransaction(async (tx) => {
      const repository = new PaymentRepository(tx);

      const pendingPayment = await repository.findPendingPayment(
        data.ownerType,
        data.ownerId,
        data.planId,
        data.billingCycle,
      );

      if (pendingPayment) {
        return {
          success: true,
          message: "Pending payment already exists.",
          data: pendingPayment,
        };
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

      const paymentNumber = await codeGenerator.generatePaymentNumber();

      const payment = await repository.createPayment({
        paymentNumber,

        ownerType: data.ownerType,

        ownerId: data.ownerId,

        bcId: data.bcId,

        planId: plan.id,

        billingCycle: data.billingCycle,

        amount: Number(pricing.price),

        taxAmount: 0,

        totalAmount: Number(pricing.price),

        paymentMethod: PaymentMethod.MANUAL,

        paymentProvider: PaymentProvider.MANUAL,

        status: PaymentStatus.PENDING,

        currency: "INR",
      });

      return {
        success: true,
        message: "Payment order created successfully.",
        data: payment,
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

    const subscriptionService = new SubscriptionService(prisma);

    const subscription = await subscriptionService.createPaidSubscription(
      {
        agentId: payment.ownerId,

        bcId: payment.bcId ?? undefined,

        ownerType: payment.ownerType,

        ownerId: payment.ownerId,

        planId: payment.planId,

        billingCycle: payment.billingCycle,

        paymentId: payment.id,
      },
      tx,
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

      const payment = await repository.findPaymentById(data.paymentId);

      // Users can only verify their own payments.
      if (!payment || payment.ownerId !== data.agentId) {
        throw new NotFoundError("Payment not found.");
      }

      if (payment.status === PaymentStatus.SUCCESS) {
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
    return withTransaction(async (tx) => {
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
    return withTransaction(async (tx) => {
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
