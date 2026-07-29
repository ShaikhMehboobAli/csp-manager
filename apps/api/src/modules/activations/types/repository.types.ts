import { SubscriptionOwnerType } from "../../../generated/prisma/enums";

export interface AssignActivationCodesRepositoryInput {
  ownerType: SubscriptionOwnerType;
  ownerId: string;
  agentId: string;
  count: number;
}
