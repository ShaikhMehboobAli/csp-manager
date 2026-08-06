import { ReportSummaryQuery } from "./report.validation";

export interface ReportFilter extends ReportSummaryQuery {
  currentAgentId: string;

  agentIds: string[];
}
