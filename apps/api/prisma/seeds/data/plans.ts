import {
  BillingCycle,
  FeatureCategory,
  PlanOwnerType,
} from "../../../src/generated/prisma/enums";

export const features = [
  {
    code: "DESKTOP_AUTOMATION",
    name: "Desktop Automation",
    description: "SBI desktop workflow automation.",
    category: FeatureCategory.MACHINE,
  },
  {
    code: "RECEIPT_SYNC",
    name: "Receipt Sync",
    description: "Minimal transaction upload and reporting.",
    category: FeatureCategory.RECEIPT,
  },
  {
    code: "CASH_MANAGEMENT",
    name: "Cash Management",
    description: "Cash and float-ledger management features.",
    category: FeatureCategory.FLOAT,
  },
  {
    code: "MOBILE_TRACKING",
    name: "Mobile Tracking",
    description: "Mobile application tracking features.",
    category: FeatureCategory.DASHBOARD,
  },
] as const;

export const plans = [
  {
    code: "BC_BASIC",
    name: "BC Basic",
    ownerType: PlanOwnerType.BC,
    level: 1,
    machineLimit: 1,

    pricing: [
      {
        billingCycle: BillingCycle.MONTHLY,
        durationDays: 30,
        price: 199,
      },
    ],
    featureCodes: [],
  },

  {
    code: "BC_PRO",
    name: "BC Professional",
    ownerType: PlanOwnerType.BC,
    level: 2,
    machineLimit: 5,

    pricing: [
      {
        billingCycle: BillingCycle.MONTHLY,
        durationDays: 30,
        price: 399,
      },
    ],
    featureCodes: [],
  },

  {
    code: "CSP_AUTOMATION",
    name: "CSP Automation",
    ownerType: PlanOwnerType.CSP,
    level: 1,
    machineLimit: 1,

    pricing: [
      {
        billingCycle: BillingCycle.MONTHLY,
        durationDays: 30,
        price: 250,
      },
    ],
    featureCodes: ["DESKTOP_AUTOMATION", "RECEIPT_SYNC"],
  },

  {
    code: "CSP_AUTOMATION_CASH_MANAGEMENT",
    name: "CSP Automation + Cash Management",
    ownerType: PlanOwnerType.CSP,
    level: 2,
    machineLimit: 1,

    pricing: [
      {
        billingCycle: BillingCycle.MONTHLY,
        durationDays: 30,
        price: 450,
      },
    ],
    featureCodes: [
      "DESKTOP_AUTOMATION",
      "RECEIPT_SYNC",
      "CASH_MANAGEMENT",
    ],
  },

  {
    code: "CSP_COMPLETE",
    name: "CSP Complete Solution",
    ownerType: PlanOwnerType.CSP,
    level: 3,
    machineLimit: 1,

    pricing: [
      {
        billingCycle: BillingCycle.MONTHLY,
        durationDays: 30,
        price: 550,
      },
    ],
    featureCodes: [
      "DESKTOP_AUTOMATION",
      "RECEIPT_SYNC",
      "CASH_MANAGEMENT",
      "MOBILE_TRACKING",
    ],
  },
] as const;
