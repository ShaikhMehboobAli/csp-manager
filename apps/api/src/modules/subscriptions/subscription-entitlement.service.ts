import { PrismaDb } from "../../core/database/prisma.types";
import { ForbiddenError } from "../../core/errors/ForbiddenError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { SubscriptionOwnerType } from "../../generated/prisma/enums";

export const DesktopFeature = {
  AUTOMATION: "DESKTOP_AUTOMATION",
  RECEIPT_SYNC: "RECEIPT_SYNC",
  CASH_MANAGEMENT: "CASH_MANAGEMENT",
  MOBILE_TRACKING: "MOBILE_TRACKING",
} as const;

/**
 * Plan features are read on most gated requests and change rarely, so they are
 * cached per process. Admin edits to a plan's features apply within the TTL.
 */
const PLAN_CACHE_TTL_MS = 60_000;

type PlanEntitlements = Awaited<
  ReturnType<SubscriptionEntitlementService["loadPlanEntitlements"]>
>;

const planCache = new Map<
  string,
  { expiresAt: number; value: Promise<PlanEntitlements> }
>();

export default class SubscriptionEntitlementService {
  constructor(private readonly db: PrismaDb) {}

  async getPlanEntitlements(planId: string): Promise<PlanEntitlements> {
    const cached = planCache.get(planId);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = this.loadPlanEntitlements(planId);

    planCache.set(planId, {
      expiresAt: Date.now() + PLAN_CACHE_TTL_MS,
      value,
    });

    // Failed lookups (e.g. plan not found) are not cached.
    value.catch(() => planCache.delete(planId));

    return value;
  }

  private async loadPlanEntitlements(planId: string) {
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

  async hasFeature(planId: string, featureCode: string) {
    const { features } = await this.getPlanEntitlements(planId);

    return features.some((feature) => feature.code === featureCode);
  }

  async requireFeature(planId: string, featureCode: string) {
    return this.requireFeatures(planId, [featureCode]);
  }

  // One plan lookup for several required features.
  async requireFeatures(planId: string, featureCodes: string[]) {
    const { features } = await this.getPlanEntitlements(planId);

    const codes = new Set(features.map((feature) => feature.code));

    if (!featureCodes.every((code) => codes.has(code))) {
      throw new ForbiddenError(
        "Your subscription does not include this feature.",
      );
    }
  }

  /**
   * Float / cash figures belong to CASH_MANAGEMENT on CSP plans.
   * BC subscriptions and viewers without one (SUPER_ADMIN) are not restricted.
   */
  async canViewCashManagement(
    subscription:
      | { ownerType: SubscriptionOwnerType; planId: string }
      | null
      | undefined,
  ) {
    if (!subscription || subscription.ownerType !== SubscriptionOwnerType.CSP) {
      return true;
    }

    return this.hasFeature(subscription.planId, DesktopFeature.CASH_MANAGEMENT);
  }
}
