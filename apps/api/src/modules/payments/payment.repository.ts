import { PrismaDb } from "../../core/database/prisma.types";
import {
  BillingCycle,
  PaymentStatus,
  SubscriptionOwnerType,
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
    ownerType: SubscriptionOwnerType,
    ownerId: string,
    planId: string,
    billingCycle: BillingCycle,
  ) {
    return this.db.payment.findFirst({
      where: {
        ownerType,
        ownerId,
        planId,
        billingCycle,
        status: PaymentStatus.PENDING,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  findActiveSubscription(
    ownerType: SubscriptionOwnerType,
    ownerId: string,
    planId: string,
  ) {
    return this.db.subscription.findFirst({
      where: {
        ownerType,
        ownerId,
        planId,
        status: SubscriptionStatus.ACTIVE,
      },
    });
  }

  findPaymentById(paymentId: string) {
    return this.db.payment.findUnique({
      where: {
        id: paymentId,
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

  findPaymentHistory(ownerId: string) {
    return this.db.payment.findMany({
      where: {
        ownerId,
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

  findPaymentDetails(paymentId: string, ownerId: string) {
    return this.db.payment.findFirst({
      where: {
        id: paymentId,
        ownerId,
      },
      include: {
        plan: true,
        subscription: true,
      },
    });
  }
}
