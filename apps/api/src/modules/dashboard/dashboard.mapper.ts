import { getTrendLabel } from "./dashboard.helper";
import { istParts } from "../../core/utils/ist";
import { ReceiptStatus } from "../../generated/prisma/enums";
import { getMachineStatus } from "./dashboard.helper";
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

/**
 * One row per transaction category (all receipt types together), for the
 * agents in view: a KO alone, or a CSP with all its KOs.
 */
export function mapServicesByCategory(services: ServiceSummaryAggregate[]) {
  const grouped = new Map<
    string,
    {
      transactionCategory: string;
      totalCount: number;
      successCount: number;
      failedCount: number;
      pendingCount: number;
      successAmount: number;
    }
  >();

  for (const service of services) {
    const item = grouped.get(service.transactionCategory) ?? {
      transactionCategory: service.transactionCategory,
      totalCount: 0,
      successCount: 0,
      failedCount: 0,
      pendingCount: 0,
      successAmount: 0,
    };

    const count = service._count.id;

    item.totalCount += count;

    if (service.status === ReceiptStatus.SUCCESS) {
      item.successCount += count;
      item.successAmount += toNumber(service._sum.amount);
    } else if (service.status === ReceiptStatus.FAILED) {
      item.failedCount += count;
    } else {
      item.pendingCount += count;
    }

    grouped.set(service.transactionCategory, item);
  }

  return [...grouped.values()].sort((a, b) => b.totalCount - a.totalCount);
}

export function mapStatusSummary(
  statuses: Array<{
    status: ReceiptStatus | null;
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

type TrendBucket = {
  label: string;

  count: number;

  amount: number;
};

// `count` is set for daily count rows; a receipt counts as one.
export function mapTransactionTrend(
  receipts: {
    transactionAt: Date | null;
    amount: unknown;
    count?: number;
  }[],
  groupBy: "hour" | "day" | "week" | "month" | "year",
): TrendBucket[] {
  const grouped = new Map<string, TrendBucket>();

  for (const receipt of receipts) {
    if (!receipt.transactionAt) {
      continue;
    }

    const label = getTrendLabel(receipt.transactionAt, groupBy);

    if (!grouped.has(label)) {
      grouped.set(label, {
        label,

        count: 0,

        amount: 0,
      });
    }

    const item = grouped.get(label)!;

    item.count += receipt.count ?? 1;

    item.amount += toNumber(receipt.amount);
  }

  return [...grouped.values()];
}

export function mapServiceTrend(
  services: {
    transactionCategory: string;

    _count: {
      id: number;
    };

    _sum: {
      amount: unknown;
    };
  }[],
) {
  return services.map((service) => ({
    transactionCategory: service.transactionCategory,

    count: service._count.id,

    amount: toNumber(service._sum.amount),
  }));
}

export function mapSuccessFailureTrend(
  receipts: {
    transactionAt: Date | null;

    status: ReceiptStatus | null;

    count?: number;
  }[],
  groupBy: "hour" | "day" | "week" | "month" | "year",
) {
  const grouped = new Map<
    string,
    {
      label: string;

      success: number;

      failed: number;
    }
  >();

  for (const receipt of receipts) {
    if (!receipt.transactionAt) {
      continue;
    }

    const label = getTrendLabel(receipt.transactionAt, groupBy);

    if (!grouped.has(label)) {
      grouped.set(label, {
        label,

        success: 0,

        failed: 0,
      });
    }

    const item = grouped.get(label)!;

    if (receipt.status === ReceiptStatus.SUCCESS) {
      item.success += receipt.count ?? 1;
    } else if (receipt.status === ReceiptStatus.FAILED) {
      item.failed += receipt.count ?? 1;
    }
  }

  return [...grouped.values()];
}

export function mapHourlyDistribution(
  receipts: {
    transactionAt: Date | null;
  }[],
) {
  const grouped = new Map<number, number>();

  for (const receipt of receipts) {
    if (!receipt.transactionAt) {
      continue;
    }

    const { hour } = istParts(receipt.transactionAt);

    grouped.set(hour, (grouped.get(hour) ?? 0) + 1);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, count]) => ({
      hour,

      count,
    }));
}

export function mapMachineSummary(machine: any) {
  if (!machine) {
    return null;
  }

  /**
   * BC Machine Summary
   */
  if ("summary" in machine) {
    return machine;
  }

  /**
   * CSP Machine Summary
   */
  return {
    machineCode: machine.machineCode,

    machineStartedAt: machine.machineStartedAt,

    firstReceiptCapturedAt: machine.firstReceiptCapturedAt,

    lastReceiptCapturedAt: machine.lastReceiptCapturedAt,

    receiptWatcherVersion: machine.watcherVersion,

    lastHeartbeatAt: machine.lastHeartbeatAt,

    connectionStatus: getMachineStatus(machine.lastHeartbeatAt),

    machineStatus: machine.status,
  };
}
