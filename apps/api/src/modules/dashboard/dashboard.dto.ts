import {
  AnalyticsPoint,
  DashboardTransactionSummary,
  FloatSummary,
} from "./dashboard.types";

export interface DashboardSummaryResponse {
  float: FloatSummary;

  transactions: DashboardTransactionSummary[];
}

export interface DashboardAnalyticsResponse {
  data: AnalyticsPoint[];
}

export interface DashboardCspMachineSummary {
  machineCode: string;

  machineStartedAt: Date | null;

  firstReceiptCapturedAt: Date | null;

  lastReceiptCapturedAt: Date | null;

  receiptWatcherVersion: string | null;

  lastHeartbeatAt: Date | null;

  connectionStatus: "ONLINE" | "OFFLINE";

  machineStatus: string;
}

export interface DashboardBcMachineSummary {
  totalMachines: number;

  onlineMachines: number;

  offlineMachines: number;

  activeMachines: number;

  inactiveMachines: number;

  latestHeartbeatAt: Date | null;

  latestReceiptCapturedAt: Date | null;
}
