export function mapPlan(plan: any) {
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
    })),

    features: plan.features.map((feature: any) => ({
      name: feature.name,
      value: feature.value,
    })),
  };
}
