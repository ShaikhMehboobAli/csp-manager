import { Prisma } from "../../generated/prisma/client";
import {
  ReceiptStatus,
  ReceiptType,
  TransactionCategory,
} from "../../generated/prisma/enums";
import {
  DashboardAnalyticsQuery,
  DashboardSummaryQuery,
} from "./dashboard.validation";

export type DashboardGroupBy = "hour" | "day" | "week" | "month" | "year";

// export interface DashboardFilter {
//   from?: Date;

//   to?: Date;

//   agentId?: string;

//   machineId?: string;

//   receiptType?: ReceiptType;

//   transactionCategory?: TransactionCategory;

//   groupBy?: DashboardGroupBy;
// }

export interface DashboardTransactionSummary {
  transactionCategory: TransactionCategory;

  receiptType: ReceiptType;

  count: number;

  amount: number;
}

export interface FloatSummary {
  cashInHand: number;

  cashInAccount: number;

  totalFloat: number;
}

export interface AnalyticsPoint {
  label: string;

  transactionCount: number;

  transactionAmount: number;
}

export interface ServiceSummaryAggregate {
  transactionCategory: TransactionCategory;

  receiptType: ReceiptType;

  status: ReceiptStatus;

  _count: {
    id: number;
  };

  _sum: {
    amount: Prisma.Decimal | null;
  };
}

export interface DashboardServiceSummary {
  transactionCategory: TransactionCategory;

  receiptType: ReceiptType;

  successCount: number;

  failedCount: number;

  successAmount: number;

  failedAmount: number;
}

export interface DashboardAnalyticsFilter extends DashboardAnalyticsQuery {
  currentAgentId: string;

  agentIds: string[];
}

export interface DashboardFilter extends DashboardSummaryQuery {
  currentAgentId: string;
  agentIds: string[];
  agentId?: string;
}
