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
    machineCount: number,
  ) {
    return this.db.payment.findFirst({
      where: {
        ownerType,
        ownerId,
        planId,
        billingCycle,
        machineCount,
        status: PaymentStatus.PENDING,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  // Serialises create-order per owner for the rest of the transaction, so
  // two concurrent requests cannot both open a payment.
  async lockOwner(ownerId: string) {
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-owner:${ownerId}`}))`;
  }

  // Row lock held until the transaction ends: a second verify/webhook for the
  // same payment waits, then sees it already SUCCESS.
  async lockPayment(paymentId: string) {
    await this.db
      .$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
  }

  findByIdempotencyKey(ownerId: string, idempotencyKey: string) {
    return this.db.payment.findUnique({
      where: {
        ownerId_idempotencyKey: {
          ownerId,
          idempotencyKey,
        },
      },
    });
  }

  findByGatewayTransactionId(gatewayTransactionId: string) {
    return this.db.payment.findUnique({
      where: {
        gatewayTransactionId,
      },
      select: {
        id: true,
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
    transactionReference: string | undefined,
    invoiceNumber: string,
  ) {
    return this.db.payment.update({
      where: {
        id: paymentId,
      },
      data: {
        subscriptionId,

        invoiceNumber,

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
