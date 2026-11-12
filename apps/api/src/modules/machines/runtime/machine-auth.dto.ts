import { Prisma } from "../../../generated/prisma/client";

export interface MachineAuthenticationInput {
  machineCode: string;
  // Not needed when the request is signed with the machine's device key.
  apiKey?: string;
  fingerprint: string;
}

export type MachineWithRelations = Prisma.MachineGetPayload<{
  include: {
    activations: {
      include: {
        subscription: true;
      };
    };
  };
}>;

export type CurrentActivation = MachineWithRelations["activations"][number];

export type Subscription = CurrentActivation["subscription"];

export interface AuthenticatedMachine {
  machine: MachineWithRelations;
  activation: CurrentActivation;
  subscription: Subscription;
}
