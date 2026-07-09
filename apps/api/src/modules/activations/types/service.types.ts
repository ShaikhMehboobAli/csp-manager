import { Activation } from "../../../generated/prisma/client";

export interface GenerateActivationsInput {
  subscriptionId: string;

  machineLimit: number;

  expiresAt: Date;
}
export interface GeneratedActivation {
  activation: Activation;
  activationPassword: string;
}
