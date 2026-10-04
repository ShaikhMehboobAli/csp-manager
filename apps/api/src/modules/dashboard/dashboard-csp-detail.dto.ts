export type DashboardCspDetailSection = "socialSecurity" | "transaction";

export interface DashboardCspMetricDailyDetail {
  date: string;
  metrics: {
    code: string;
    name: string;
    value: number;
    source: "RECEIPT" | "MANUAL";
  }[];
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
}

export interface DashboardCspDetailResponse {
  agentId: string;
  cspName: string;
  month: string;
  section: DashboardCspDetailSection;
  socialSecurity?: DashboardCspMetricDailyDetail[];
  transaction?: DashboardCspTransactionDailyDetail[];
}
