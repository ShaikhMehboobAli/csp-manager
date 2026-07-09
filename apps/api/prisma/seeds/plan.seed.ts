import prisma from "../../src/config/prisma";

import { plans } from "./data/plans";

export async function seedPlans() {
  console.log("🌱 Seeding plans...");

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: {
        code: plan.code,
      },
      update: {
        name: plan.name,
        ownerType: plan.ownerType,
        level: plan.level,
        machineLimit: plan.machineLimit,
        isActive: true,
        isDeleted: false,
      },
      create: {
        code: plan.code,
        name: plan.name,
        ownerType: plan.ownerType,
        level: plan.level,
        machineLimit: plan.machineLimit,
      },
    });
  }

  console.log("✅ Plans seeded.");
}
