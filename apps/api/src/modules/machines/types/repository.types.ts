import { MachineStatus } from "../../../generated/prisma/enums";

export interface CreateMachineInput {
  machineCode: string;

  machineName?: string;

  fingerprint: string;

  watcherVersion: string;

  osName?: string;

  osVersion?: string;

  deviceName?: string;

  ipAddress?: string;

  apiKeyHash: string;

  apiKeyIssuedAt: Date;

  apiKeyExpiresAt: Date;

  status: MachineStatus;
  currentAgentId?: string;
  agentId: string;
}
