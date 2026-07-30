import { Prisma } from "../../../generated/prisma/client";

export interface ActivateMachineInput {
  agentId: string;

  activationCode: string;

  activationPassword: string;

  machine: {
    fingerprint: string;

    machineName?: string;

    watcherVersion: string;

    osName?: string;

    osVersion?: string;

    deviceName?: string;

    ipAddress?: string;
  };
}

// export type ActivationWithSubscription = Prisma.ActivationGetPayload<{
//   include: {
//     subscription: true;
//     machine: true;
//   };
// }>;

export type ActivationWithSubscription = Prisma.ActivationGetPayload<{
  include: {
    subscription: true;
  };
}>;

export type MachineWithActivations = Prisma.MachineGetPayload<{
  include: {
    activations: {
      include: {
        subscription: true;
      };
    };
  };
}>;
