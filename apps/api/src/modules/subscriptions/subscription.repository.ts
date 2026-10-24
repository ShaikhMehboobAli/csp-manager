import { PrismaDb } from "../../core/database/prisma.types";
import {
  Prisma,
  PrismaClient,
  Subscription,
} from "../../generated/prisma/client";

import {
  PaymentMethod,
  PlanOwnerType,
  SubscriptionEventType,
  SubscriptionOwnerType,
  SubscriptionStatus,
  SubscriptionType,
} from "../../generated/prisma/enums";

export default class SubscriptionRepository {
  // constructor(private readonly db: PrismaDb) {}
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}

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
        features: {
          include: {
            feature: true,
          },
        },
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

  /**
   * Latest ACTIVE or EXPIRED subscription for an owner, used as the base for
   * renewals, upgrades and machine carry-over.
   */
  findLatestSubscription(ownerType: SubscriptionOwnerType, ownerId: string) {
    return this.db.subscription.findFirst({
      where: {
        ownerType,
        ownerId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED],
        },
      },
      orderBy: {
        endDate: "desc",
      },
    });
  }

  extendSubscription(
    subscriptionId: string,
    endDate: Date,
    additionalAmount: number,
  ) {
    return this.db.subscription.update({
      where: {
        id: subscriptionId,
      },
      data: {
        endDate,
        status: SubscriptionStatus.ACTIVE,
        amountPaid: {
          increment: additionalAmount,
        },
      },
    });
  }

  expireSubscription(subscriptionId: string) {
    return this.db.subscription.update({
      where: {
        id: subscriptionId,
      },
      data: {
        status: SubscriptionStatus.EXPIRED,
      },
    });
  }

  /**
   * Marks subscriptions whose end date (and grace period, if any) has passed.
   */
  expireEndedSubscriptions(now: Date) {
    return this.db.subscription.updateMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        subscriptionType: {
          not: SubscriptionType.LIFETIME,
        },
        endDate: {
          lt: now,
        },
        OR: [
          {
            graceEndsAt: null,
          },
          {
            graceEndsAt: {
              lt: now,
            },
          },
        ],
      },
      data: {
        status: SubscriptionStatus.EXPIRED,
      },
    });
  }

  createHistory(data: {
    subscriptionId: string;
    eventType: SubscriptionEventType;
    previousPlanId?: string;
    newPlanId: string;
    amount: number;
    remarks?: string;
  }) {
    return this.db.subscriptionHistory.create({
      data,
    });
  }

  findCurrentSubscription(ownerId: string) {
    return this.db.subscription.findFirst({
      where: {
        ownerId,
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

  // findActiveSubscription(agentId: string) {
  //   return this.db.subscription.findFirst({
  //     where: {
  //       agentId,
  //       status: "ACTIVE",
  //     },
  //   });
  // }

  findSubscriptionHistory(ownerId: string) {
    return this.db.subscription.findMany({
      where: {
        ownerId,
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
  async findActiveSubscription(
    ownerType: SubscriptionOwnerType,
    ownerId: string,
  ) {
    const now = new Date();

    return this.db.subscription.findFirst({
      where: {
        ownerType,
        ownerId,
        status: SubscriptionStatus.ACTIVE,
        startDate: {
          lte: now,
        },
        endDate: {
          gte: now,
        },
      },
      include: {
        plan: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async getCurrentSubscription(ownerId: string, ownerType?: "BC" | "CSP") {
    return this.db.subscription.findFirst({
      where: {
        ownerId,

        ...(ownerType && {
          ownerType,
        }),
      },

      orderBy: {
        createdAt: "desc",
      },

      include: {
        plan: true,

        activations: {
          where: {
            isCurrent: true,
          },
        },
      },
    });
  }
}
