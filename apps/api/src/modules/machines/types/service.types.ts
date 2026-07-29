import { SubscriptionOwnerType } from "../../../generated/prisma/enums";

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
