import { ReceiptStatus } from "../../generated/prisma/enums";
import {
  DashboardServiceSummary,
  ServiceSummaryAggregate,
} from "./dashboard.types";

export function calculateOverview(overview: {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  totalTransactionAmount: number;
  lastTransactionAt: Date | null;
}) {
  const successRate =
    overview.totalTransactions === 0
      ? 0
      : Number(
          (
            (overview.successfulTransactions / overview.totalTransactions) *
            100
          ).toFixed(2),
        );

  const failureRate =
    overview.totalTransactions === 0
      ? 0
      : Number(
          (
            (overview.failedTransactions / overview.totalTransactions) *
            100
          ).toFixed(2),
        );

  return {
    ...overview,

    successRate,

    failureRate,
  };
}

export function mapServiceSummary(services: ServiceSummaryAggregate[]) {
  const grouped = new Map<string, DashboardServiceSummary>();

  for (const service of services) {
    const key = `${service.transactionCategory}_${service.receiptType}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        transactionCategory: service.transactionCategory,

        receiptType: service.receiptType,

        successCount: 0,

        failedCount: 0,

        successAmount: 0,

        failedAmount: 0,
      });
    }

    // const item = grouped.get(key)!;
    let item = grouped.get(key);

    if (!item) {
      item = {
        transactionCategory: service.transactionCategory,

        receiptType: service.receiptType,

        successCount: 0,

        failedCount: 0,

        successAmount: 0,

        failedAmount: 0,
      };

      grouped.set(key, item);
    }

    if (service.status === ReceiptStatus.SUCCESS) {
      item.successCount = service._count.id;

      item.successAmount = Number(service._sum.amount ?? 0);
    } else if (service.status === ReceiptStatus.FAILED) {
      item.failedCount = service._count.id;

      item.failedAmount = Number(service._sum.amount ?? 0);
    }
  }

  return Array.from(grouped.values());
}

export function mapStatusSummary(
  statuses: Array<{
    status: ReceiptStatus;
    _count: {
      id: number;
    };
  }>,
) {
  let success = 0;
  let failed = 0;

  for (const item of statuses) {
    switch (item.status) {
      case ReceiptStatus.SUCCESS:
        success = item._count.id;
        break;

      case ReceiptStatus.FAILED:
        failed = item._count.id;
        break;
    }
  }

  return {
    success,
    failed,
    total: success + failed,
  };
}

export function toNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number(value);
}

export function mapFloatSummary(
  floatSummary: {
    openingFloat: unknown;
    currentCashInHand: unknown;
    currentCashInAccount: unknown;
    currentTotalFloat: unknown;
    lastReceiptAt: Date | null;
    updatedAt: Date;
  } | null,
) {
  if (!floatSummary) {
    return {
      openingFloat: 0,
      currentCashInHand: 0,
      currentCashInAccount: 0,
      currentTotalFloat: 0,
      lastReceiptAt: null,
      updatedAt: null,
    };
  }

  return {
    openingFloat: toNumber(floatSummary.openingFloat),

    currentCashInHand: toNumber(floatSummary.currentCashInHand),

    currentCashInAccount: toNumber(floatSummary.currentCashInAccount),

    currentTotalFloat: toNumber(floatSummary.currentTotalFloat),

    lastReceiptAt: floatSummary.lastReceiptAt,

    updatedAt: floatSummary.updatedAt,
  };
}

export function mapRecentTransactions<
  T extends {
    amount: unknown;
  },
>(transactions: T[]) {
  return transactions.map((transaction) => ({
    ...transaction,

    amount: toNumber(transaction.amount),
  }));
}
