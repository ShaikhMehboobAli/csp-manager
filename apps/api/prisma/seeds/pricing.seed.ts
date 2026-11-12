import prisma from "../../src/config/prisma";

import { plans } from "./data/plans";

export async function seedPlanPricing() {
  console.log("🌱 Seeding plan pricing...");

  for (const plan of plans) {
    const dbPlan = await prisma.plan.findUnique({
      where: {
        code: plan.code,
      },
    });

    if (!dbPlan) {
      continue;
    }

    // Pricing belongs to SUPER_ADMIN once created: seeding only adds missing
    // billing cycles and never overwrites or deactivates existing prices.
    for (const pricing of plan.pricing) {
      await prisma.planPricing.upsert({
        where: {
          planId_billingCycle: {
            planId: dbPlan.id,
            billingCycle: pricing.billingCycle,
          },
        },
        update: {},
        create: {
          planId: dbPlan.id,
          billingCycle: pricing.billingCycle,
          durationDays: pricing.durationDays,
          price: pricing.price,
        },
      });
    }
  }

  console.log("✅ Plan pricing seeded.");
}
