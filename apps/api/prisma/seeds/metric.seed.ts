import prisma from "../../src/config/prisma";

const metrics = [
  {
    code: "APY",
    name: "APY",
    category: "SOCIAL_SECURITY",
    source: "RECEIPT",
    inputType: "COUNT",
  },
  {
    code: "PMJJBY",
    name: "PMJJBY",
    category: "SOCIAL_SECURITY",
    source: "RECEIPT",
    inputType: "COUNT",
  },
  {
    code: "PMSBY",
    name: "PMSBY",
    category: "SOCIAL_SECURITY",
    source: "RECEIPT",
    inputType: "COUNT",
  },
  {
    code: "MUDRA_LOAN",
    name: "Mudra Loan",
    category: "SOCIAL_SECURITY",
    source: "RECEIPT",
    inputType: "COUNT",
  },
  {
    code: "DRA_PAYMENT",
    name: "DRA Payment",
    category: "SOCIAL_SECURITY",
    source: "MANUAL",
    inputType: "COUNT",
  },
  {
    code: "SBI_LIFE",
    name: "SBI Life",
    category: "SOCIAL_SECURITY",
    source: "MANUAL",
    inputType: "COUNT",
  },
  {
    code: "SIP",
    name: "No. of SIP",
    category: "SOCIAL_SECURITY",
    source: "MANUAL",
    inputType: "COUNT",
  },
] as const;

export async function seedMetrics() {
  console.log("🌱 Seeding metric definitions...");

  for (const metric of metrics) {
    await prisma.metricDefinition.upsert({
      where: {
        code: metric.code,
      },
      update: {
        name: metric.name,
        category: metric.category,
        source: metric.source,
        inputType: metric.inputType,
        isActive: true,
      },
      create: {
        code: metric.code,
        name: metric.name,
        category: metric.category,
        source: metric.source,
        inputType: metric.inputType,
        isActive: true,
      },
    });
  }

  console.log(`✅ ${metrics.length} metric definitions seeded.`);
}
