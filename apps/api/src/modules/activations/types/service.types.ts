import {
  Activation,
  SubscriptionOwnerType,
} from "../../../generated/prisma/client";

export interface GenerateActivationsInput {
  subscriptionId: string;

  machineLimit: number;

  expiresAt: Date;
}
export interface GeneratedActivation {
  activation: Activation;
  activationPassword: string;
}

export interface AssignActivationInput {
  activationId: string;

  assignedAgentId: string;

  assignedByOwnerType: SubscriptionOwnerType;

  assignedByOwnerId: string;
}
