import prisma from "../src/config/prisma";

import { seedPlans } from "./seeds/plan.seed";
import { seedPlanPricing } from "./seeds/pricing.seed";
import { seedRunningNumbers } from "./seeds/running-number.seed";
import { seedMetrics } from "./seeds/metric.seed";
import { seedFeatures } from "./seeds/feature.seed";
import { seedPlanFeatures } from "./seeds/plan-feature.seed";

async function main() {
  console.log("🌱 Starting database seed...");

  await seedRunningNumbers();

  await seedPlans();

  await seedPlanPricing();

  await seedFeatures();

  await seedPlanFeatures();

  await seedMetrics();

  console.log("✅ Database seed completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
