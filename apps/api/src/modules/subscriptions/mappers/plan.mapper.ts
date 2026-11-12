import { Prisma } from "../../../generated/prisma/client";

/** `gstPercent`: GST added to the price at checkout (CSP plans: per machine). */
export function mapPlan(plan: any, gstPercent = 0) {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    ownerType: plan.ownerType,
    level: plan.level,
    machineLimit: plan.machineLimit,

    pricing: plan.pricings.map((pricing: any) => ({
      billingCycle: pricing.billingCycle,
      durationDays: pricing.durationDays,
      price: pricing.price.toString(),
      gstPercent,
      gstAmount: gstOf(pricing.price, gstPercent).toFixed(2),
      priceWithGst: new Prisma.Decimal(pricing.price)
        .plus(gstOf(pricing.price, gstPercent))
        .toFixed(2),
    })),

    features: plan.features.map((feature: any) => ({
      code: feature.feature.code,
      name: feature.feature.name,
      description: feature.feature.description,
      category: feature.feature.category,
    })),
  };
}

function gstOf(price: Prisma.Decimal | string | number, gstPercent: number) {
  return new Prisma.Decimal(price)
    .times(gstPercent)
    .dividedBy(100)
    .toDecimalPlaces(2);
}
