import { BillingCycle, PlanOwnerType } from "../../../generated/prisma/enums";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";

export interface PlanResponse {
  id: string;
  code: string;
  name: string;
  ownerType: PlanOwnerType;
  level: number;
  machineLimit: number | null;

  pricing: {
    billingCycle: BillingCycle;
    durationDays: number;
    price: Decimal;
  }[];

  features: {
    code: string;
    name: string;
    description: string | null;
    category: string | null;
  }[];
}
