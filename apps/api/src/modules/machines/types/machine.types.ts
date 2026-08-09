import { AgentType, MachineStatus } from "../../../generated/prisma/enums";

export interface TransactionSummary {
  count: number;
  amount: number;
  success: number;
  failed: number;
}

export interface ServiceSummary {
  transactionCategory: string;
  count: number;
}

export interface MachineSummary {
  lastHeartbeatAt: Date | null;
  lastReceiptCapturedAt: Date | null;
}

export interface FloatSummary {
  openingFloat: unknown;
  currentCashInHand: unknown;
  currentCashInAccount: unknown;
  currentTotalFloat: unknown;
  lastReceiptAt: Date | null;
  lastReceiptUpdatedAt: Date | null;
}

export interface ChildAgentOverview {
  id: string;
  agentId: string;
  name: string;
  type: string;
  mobile: string | null;
  email: string | null;
  address: string | null;
  bcId: string | null;
  parentAgentId: string | null;
  linkedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  machine: MachineSummary;

  transaction: TransactionSummary;

  services: ServiceSummary[];
}

export interface MachineOverview {
  machine: {
    machineId: string;
    machineCode: string;
    machineName: string | null;

    watcherVersion: string;
    watcherEnabled: boolean;

    machineStatus: string;

    connectionStatus: string;

    lastHeartbeatAt: Date | null;

    lastStartupAt: Date | null;

    lastReceiptCapturedAt: Date | null;

    ipAddress: string | null;

    deviceName: string | null;

    osName: string | null;

    osVersion: string | null;
  };

  agent: {
    agentId: string;
    name: string;
    type: string;
  };

  float: FloatSummary | null;

  transaction: TransactionSummary;

  services: ServiceSummary[];

  children: ChildAgentOverview[];
}

// export interface MachineListFilter {
//   page: number;

//   limit: number;

//   search?: string;

//   agentId?: string;

//   agentType?: "BC" | "CSP" | "KO";

//   machineStatus?: string;

//   connectionStatus?: "ONLINE" | "OFFLINE";

//   watcherEnabled?: boolean;

//   sortBy: "updatedAt" | "machineName" | "machineCode" | "lastHeartbeatAt";

//   sortOrder: "asc" | "desc";
// }

export interface MachineListFilter {
  page: number;

  limit: number;

  search?: string;

  agentId?: string;

  agentType?: AgentType;

  machineStatus?: MachineStatus;

  connectionStatus?: "ONLINE" | "OFFLINE";

  watcherEnabled?: boolean;

  sortBy: "updatedAt" | "machineName" | "machineCode" | "lastHeartbeatAt";

  sortOrder: "asc" | "desc";

  from?: Date;

  to?: Date;
}
