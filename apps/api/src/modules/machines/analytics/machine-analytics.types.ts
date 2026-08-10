export interface MachineAnalyticsFilter {
  machineId: string;

  currentAgentId: string;

  agentIds: string[];

  from?: Date;

  to?: Date;

  groupBy?: "day" | "week" | "month";
}
