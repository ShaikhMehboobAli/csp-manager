import { PrismaDb } from "../../core/database/prisma.types";
import {
  BillingCycle,
  PaymentStatus,
  SubscriptionStatus,
} from "../../generated/prisma/enums";
import { CreatePaymentInput } from "./types/repository.types";
import { CreatePaymentOrderInput } from "./types/service.types";

export default class PaymentRepository {
  constructor(private readonly db: PrismaDb) {}

  findPlanWithPricing(planId: string) {
    return this.db.plan.findUnique({
      where: {
        id: planId,
      },
      include: {
        pricings: {
          where: {
            isActive: true,
          },
        },
      },
    });
  }

  createPayment(data: CreatePaymentInput) {
    return this.db.payment.create({
      data,
    });
  }

  findPendingPayment(
    agentId: string,
    planId: string,
    billingCycle: BillingCycle,
  ) {
    return this.db.payment.findFirst({
      where: {
        agentId,
        planId,
        billingCycle,
        status: PaymentStatus.PENDING,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  findActiveSubscription(agentId: string, planId: string) {
    return this.db.subscription.findFirst({
      where: {
        agentId,
        planId,
        status: SubscriptionStatus.ACTIVE,
      },
    });
  }

  findPaymentById(paymentId: string, agentId: string) {
    return this.db.payment.findUnique({
      where: {
        id: paymentId,
        agentId,
      },
    });
  }

  findPaymentByIdForWebhook(paymentId: string) {
    return this.db.payment.findUnique({
      where: {
        id: paymentId,
      },
    });
  }

  updatePaymentSuccess(
    paymentId: string,
    subscriptionId: string,
    gatewayTransactionId: string,
    transactionReference?: string,
  ) {
    return this.db.payment.update({
      where: {
        id: paymentId,
      },
      data: {
        subscriptionId,

        gatewayTransactionId,

        transactionReference,

        status: PaymentStatus.SUCCESS,

        paidAt: new Date(),
      },
    });
  }

  findPaymentHistory(agentId: string) {
    return this.db.payment.findMany({
      where: {
        agentId,
      },
      include: {
        plan: {
          select: {
            id: true,
            code: true,
            name: true,
            ownerType: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  findPaymentDetails(paymentId: string, agentId: string) {
    return this.db.payment.findFirst({
      where: {
        id: paymentId,
        agentId,
      },
      include: {
        plan: true,
        subscription: true,
      },
    });
  }
}
