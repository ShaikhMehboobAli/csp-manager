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

/**
 * BC Dashboard → CSP Social Security tab
 */
// export interface DashboardCspSocialSecuritySummary {
//   agentId: string;

//   cspName: string;

//   location: string | null;

//   bcName: string | null;

//   mudra: number;

//   apy: number;

//   pmjjby: number;

//   pmsby: number;
// }

export interface DashboardCspMetricSummary {
  code: string;
  name: string;
  value: number;
  source: "RECEIPT" | "MANUAL";
}

export interface DashboardCspSocialSecuritySummary {
  agentId: string;
  cspName: string;
  location: string | null;
  bcName: string | null;
  metrics: DashboardCspMetricSummary[];
}

/**
 * BC Dashboard → CSP Transaction tab
 */
export interface DashboardCspTransactionSummary {
  agentId: string;

  cspName: string;

  totalTxn: number;

  // Passbook Printer is not implemented yet.
  passbookPrinter: number;

  cashWithdrawal: number;

  cashDeposit: number;

  microAtmTxn: number;

  accountOpening: number;

  miniStatement: number;

  balanceInquiry: number;

  moneyTransfer: number;

  fundTransfer: number;
}

/**
 * Complete CSP-wise section of BC Dashboard
 */
export interface DashboardCspSummary {
  socialSecurity: DashboardCspSocialSecuritySummary[];

  transactions: DashboardCspTransactionSummary[];
}

export type DashboardCspDetailSection = "socialSecurity" | "transaction";

export interface DashboardCspSocialSecurityDailyDetail {
  date: string;

  mudra: number;

  apy: number;

  pmjjby: number;

  pmsby: number;
}

export interface DashboardCspTransactionDailyDetail {
  date: string;

  totalTxn: number;

  passbookPrinter: number;

  cashWithdrawal: number;

  cashDeposit: number;

  microAtmTxn: number;

  accountOpening: number;

  miniStatement: number;

  balanceInquiry: number;

  moneyTransfer: number;

  fundTransfer: number;
}

export interface DashboardCspDetailResponse {
  agentId: string;

  cspName: string;

  month: string;

  section: DashboardCspDetailSection;

  data:
    | DashboardCspSocialSecurityDailyDetail[]
    | DashboardCspTransactionDailyDetail[];
}
