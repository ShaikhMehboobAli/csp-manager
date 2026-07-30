export interface HandleHeartbeatInput {
  machineId: string;
  currentAgentId?: string | null;
}

export interface CreateMachineSessionInput {
  machineSessionId: string;
  machineId: string;
  firstAgentId?: string | null;
  lastAgentId?: string | null;
}
