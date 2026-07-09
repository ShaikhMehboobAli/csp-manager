import { PrismaDb } from "../../core/database/prisma.types";

import {
  PaymentMethod,
  PlanOwnerType,
  SubscriptionOwnerType,
  SubscriptionStatus,
  SubscriptionType,
} from "../../generated/prisma/enums";

export default class SubscriptionRepository {
  constructor(private readonly db: PrismaDb) {}

  getPlans(ownerType: PlanOwnerType) {
    return this.db.plan.findMany({
      where: {
        ownerType,
        isActive: true,
        isDeleted: false,
      },
      include: {
        pricings: {
          where: {
            isActive: true,
          },
          orderBy: {
            durationDays: "asc",
          },
        },
        features: true,
      },
      orderBy: {
        level: "asc",
      },
    });
  }

  findPlanById(planId: string) {
    return this.db.plan.findUnique({
      where: {
        id: planId,
      },
    });
  }

  createSubscription(data: {
    subscriptionNumber: string;

    ownerType: SubscriptionOwnerType;
    ownerId: string;

    agentId: string;
    bcId?: string;

    planId: string;

    machineLimit: number;

    amountPaid: number;

    startDate: Date;
    endDate: Date;
  }) {
    return this.db.subscription.create({
      data: {
        subscriptionNumber: data.subscriptionNumber,
        ownerType: data.ownerType,
        ownerId: data.ownerId,
        agentId: data.agentId,
        bcId: data.bcId,
        planId: data.planId,
        machineLimit: data.machineLimit,
        amountPaid: data.amountPaid,
        startDate: data.startDate,
        endDate: data.endDate,
        subscriptionType: SubscriptionType.PAID,
        status: SubscriptionStatus.ACTIVE,
      },
    });
  }

  expireActiveSubscription(agentId: string) {
    return this.db.subscription.updateMany({
      where: {
        agentId,
        status: SubscriptionStatus.ACTIVE,
      },
      data: {
        status: SubscriptionStatus.EXPIRED,
      },
    });
  }

  findCurrentSubscription(agentId: string) {
    return this.db.subscription.findFirst({
      where: {
        agentId,
        status: "ACTIVE",
      },
      include: {
        plan: true,
        payments: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
      orderBy: {
        endDate: "desc",
      },
    });
  }

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

  findActiveSubscription(agentId: string) {
    return this.db.subscription.findFirst({
      where: {
        agentId,
        status: "ACTIVE",
      },
    });
  }

  findSubscriptionHistory(agentId: string) {
    return this.db.subscription.findMany({
      where: {
        agentId,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.EXPIRED,
            SubscriptionStatus.CANCELLED,
            SubscriptionStatus.SUSPENDED,
          ],
        },
      },
      include: {
        plan: true,
        payments: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }
}
