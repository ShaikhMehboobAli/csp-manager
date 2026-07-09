import prisma from "../../src/config/prisma";

import { RunningNumberType } from "../../src/generated/prisma/enums";

export async function seedRunningNumbers() {
  console.log("🌱 Seeding running numbers...");

  for (const type of [
    RunningNumberType.SUBSCRIPTION,
    RunningNumberType.PAYMENT,
    RunningNumberType.INVOICE,
  ]) {
    await prisma.runningNumber.upsert({
      where: {
        type,
      },
      update: {},
      create: {
        type,
        currentValue: 0,
      },
    });
  }

  console.log("✅ Running numbers seeded.");
}
