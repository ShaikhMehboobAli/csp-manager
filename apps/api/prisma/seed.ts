import prisma from "../src/config/prisma";

import { seedPlans } from "./seeds/plan.seed";
import { seedPlanPricing } from "./seeds/pricing.seed";
import { seedRunningNumbers } from "./seeds/running-number.seed";

async function main() {
  console.log("🌱 Starting database seed...");

  await seedRunningNumbers();
  await seedPlans();
  await seedPlanPricing();

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
