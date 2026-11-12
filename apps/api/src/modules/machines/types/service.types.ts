import { Prisma } from "../../../generated/prisma/client";

export interface ActivateMachineInput {
  agentId: string;

  cashInHand?: number;

  cashDenomination?: Partial<Record<string, number>>;

  // Counted cash in hand ≠ what the CSP gave: where the difference came
  // from / went to.
  differenceSource?: "CASH_IN_ACCOUNT" | "OTHER";

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

    devicePublicKey?: string;
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
