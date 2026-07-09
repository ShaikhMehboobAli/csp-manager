import {
  BillingCycle,
  PlanOwnerType,
} from "../../../src/generated/prisma/enums";

export const plans = [
  {
    code: "BC_BASIC",
    name: "BC Basic",
    ownerType: PlanOwnerType.BC,
    level: 1,
    machineLimit: 5,

    pricing: [
      {
        billingCycle: BillingCycle.MONTHLY,
        durationDays: 30,
        price: 499,
      },
      {
        billingCycle: BillingCycle.YEARLY,
        durationDays: 365,
        price: 4999,
      },
    ],
  },

  {
    code: "BC_PRO",
    name: "BC Professional",
    ownerType: PlanOwnerType.BC,
    level: 2,
    machineLimit: 25,

    pricing: [
      {
        billingCycle: BillingCycle.MONTHLY,
        durationDays: 30,
        price: 999,
      },
      {
        billingCycle: BillingCycle.YEARLY,
        durationDays: 365,
        price: 9999,
      },
    ],
  },

  {
    code: "CSP_BASIC",
    name: "CSP Basic",
    ownerType: PlanOwnerType.CSP,
    level: 1,
    machineLimit: 1,

    pricing: [
      {
        billingCycle: BillingCycle.MONTHLY,
        durationDays: 30,
        price: 199,
      },
      {
        billingCycle: BillingCycle.YEARLY,
        durationDays: 365,
        price: 1999,
      },
    ],
  },

  {
    code: "CSP_PRO",
    name: "CSP Professional",
    ownerType: PlanOwnerType.CSP,
    level: 2,
    machineLimit: 5,

    pricing: [
      {
        billingCycle: BillingCycle.MONTHLY,
        durationDays: 30,
        price: 399,
      },
      {
        billingCycle: BillingCycle.YEARLY,
        durationDays: 365,
        price: 3999,
      },
    ],
  },
] as const;
