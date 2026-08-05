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
