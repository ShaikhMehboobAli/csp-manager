import prisma from "../../src/config/prisma";
import { plans } from "./data/plans";

export async function seedPlanFeatures() {
  for (const plan of plans) {
    const dbPlan = await prisma.plan.findUnique({
      where: {
        code: plan.code,
      },
      select: {
        id: true,
      },
    });

    if (!dbPlan) {
      continue;
    }

    await prisma.planFeature.deleteMany({
      where: {
        planId: dbPlan.id,
      },
    });

    if (plan.featureCodes.length === 0) {
      continue;
    }

    const dbFeatures = await prisma.feature.findMany({
      where: {
        code: {
          in: plan.featureCodes,
        },
        isActive: true,
        isDeleted: false,
      },
      select: {
        id: true,
        code: true,
      },
    });

    if (dbFeatures.length !== plan.featureCodes.length) {
      throw new Error(`Missing configured feature for plan ${plan.code}.`);
    }

    await prisma.planFeature.createMany({
      data: dbFeatures.map((feature) => ({
        planId: dbPlan.id,
        featureId: feature.id,
      })),
    });
  }
}
