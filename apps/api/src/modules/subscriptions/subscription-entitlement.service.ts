import { PrismaDb } from "../../core/database/prisma.types";
import { ForbiddenError } from "../../core/errors/ForbiddenError";
import { NotFoundError } from "../../core/errors/NotFoundError";

export const DesktopFeature = {
  AUTOMATION: "DESKTOP_AUTOMATION",
  RECEIPT_SYNC: "RECEIPT_SYNC",
  CASH_MANAGEMENT: "CASH_MANAGEMENT",
  MOBILE_TRACKING: "MOBILE_TRACKING",
} as const;

export default class SubscriptionEntitlementService {
  constructor(private readonly db: PrismaDb) {}

  async getPlanEntitlements(planId: string) {
    const plan = await this.db.plan.findUnique({
      where: {
        id: planId,
      },
      include: {
        features: {
          where: {
            feature: {
              isActive: true,
              isDeleted: false,
            },
          },
          include: {
            feature: true,
          },
        },
      },
    });

    if (!plan) {
      throw new NotFoundError("Subscription plan not found.");
    }

    return {
      plan,
      features: plan.features.map((planFeature) => planFeature.feature),
    };
  }

  async requireFeature(planId: string, featureCode: string) {
    const { features } = await this.getPlanEntitlements(planId);

    if (!features.some((feature) => feature.code === featureCode)) {
      throw new ForbiddenError(
        "Your subscription does not include this feature.",
      );
    }
  }
}
