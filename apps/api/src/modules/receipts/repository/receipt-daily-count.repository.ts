import { PrismaDb } from "../../../core/database/prisma.types";
import { istCalendarDate, istDateKey } from "../../../core/utils/ist";
import { Prisma } from "../../../generated/prisma/client";
import {
  ReceiptStatus,
  ReceiptType,
  TransactionCategory,
} from "../../../generated/prisma/enums";

/** The receipt fields a daily count is keyed and summed on. */
export type CountedReceipt = {
  agentId: string;
  machineId: string;
  receiptType: ReceiptType;
  transactionCategory: TransactionCategory;
  transactionType: string;
  status: ReceiptStatus | null;
  transactionAt: Date | null;
  amount: Prisma.Decimal | number | null;
};

export type DailyCountFilter = {
  agentId?: string;
  agentIds?: string[];
  machineId?: string;
  receiptType?: ReceiptType;
  receiptTypes?: ReceiptType[];
  transactionCategory?: TransactionCategory;
  transactionCategories?: TransactionCategory[];
  status?: ReceiptStatus;
  from?: Date;
  to?: Date;
};

/**
 * Daily count rows matching a receipt filter. Ranges are whole IST days, so
 * from/to map onto the IST calendar days containing them.
 */
export function buildDailyCountWhere(
  filter: DailyCountFilter,
): Prisma.ReceiptDailyCountWhereInput {
  const where: Prisma.ReceiptDailyCountWhereInput = {};

  if (filter.agentId) {
    where.agentId = filter.agentId;
  } else if (filter.agentIds?.length) {
    where.agentId = { in: filter.agentIds };
  }

  if (filter.machineId) {
    where.machineId = filter.machineId;
  }

  if (filter.receiptTypes?.length) {
    where.receiptType = { in: filter.receiptTypes };
  } else if (filter.receiptType) {
    where.receiptType = filter.receiptType;
  }

  if (filter.transactionCategories?.length) {
    where.transactionCategory = { in: filter.transactionCategories };
  } else if (filter.transactionCategory) {
    where.transactionCategory = filter.transactionCategory;
  }

  if (filter.status) {
    where.status = filter.status;
  }

  if (filter.from || filter.to) {
    where.date = {
      ...(filter.from && { gte: istCalendarDate(filter.from) }),
      ...(filter.to && { lte: istCalendarDate(filter.to) }),
    };
  }

  return where;
}

/**
 * Daily count groups in the shape of receipt groupBy results (`_count.id`,
 * `_sum.amount`), so the existing mappers stay unchanged.
 */
export function asReceiptGroups<
  T extends { _sum: { count: number | null; amount?: Prisma.Decimal | null } },
>(rows: T[]) {
  return rows.map(({ _sum, ...row }) => ({
    ...row,
    _count: { id: _sum.count ?? 0 },
    _sum: { amount: _sum.amount ?? null },
  }));
}

/**
 * Uploads take this lock shared (they never wait for each other); the repair
 * step takes it exclusive, so it never runs between an upload's receipt insert
 * and its count update.
 */
const DAILY_COUNT_LOCK_KEY = 72031180;

/** Receipts grouped the same way as the daily counts. */
const RECEIPT_GROUPS_SQL = Prisma.sql`
  SELECT
    ("transactionAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS "date",
    "agentId", "machineId", "receiptType", "transactionCategory",
    "transactionType", "status",
    COUNT(*)::int AS "count",
    COALESCE(SUM("amount"), 0) AS "amount",
    MIN("transactionAt") AS "firstTransactionAt",
    MAX("transactionAt") AS "lastTransactionAt"
  FROM "Receipt"
  WHERE "transactionAt" IS NOT NULL AND "status" IS NOT NULL
  GROUP BY 1, "agentId", "machineId", "receiptType", "transactionCategory",
    "transactionType", "status"
`;

export default class ReceiptDailyCountRepository {
  constructor(private readonly db: PrismaDb) {}

  /**
   * Adds newly saved receipts to their daily counts. Call it in the upload
   * transaction with only the receipts that were inserted, so retries don't
   * count twice.
   */
  async record(receipts: CountedReceipt[]) {
    const groups = new Map<
      string,
      {
        date: string;
        receipt: CountedReceipt;
        count: number;
        amount: Prisma.Decimal;
        first: Date;
        last: Date;
      }
    >();

    for (const receipt of receipts) {
      // Dashboards only count receipts with a time and a status.
      if (!receipt.transactionAt || !receipt.status) {
        continue;
      }

      const date = istDateKey(receipt.transactionAt);

      const key = [
        date,
        receipt.agentId,
        receipt.machineId,
        receipt.receiptType,
        receipt.transactionCategory,
        receipt.transactionType,
        receipt.status,
      ].join("\u0000");

      const group = groups.get(key) ?? {
        date,
        receipt,
        count: 0,
        amount: new Prisma.Decimal(0),
        first: receipt.transactionAt,
        last: receipt.transactionAt,
      };

      group.count += 1;
      group.amount = group.amount.plus(receipt.amount ?? 0);

      if (receipt.transactionAt < group.first) {
        group.first = receipt.transactionAt;
      }

      if (receipt.transactionAt > group.last) {
        group.last = receipt.transactionAt;
      }

      groups.set(key, group);
    }

    if (groups.size === 0) {
      return;
    }

    // Must run inside the upload's transaction (released at commit).
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock_shared(${DAILY_COUNT_LOCK_KEY})`;

    // Sorted by key so concurrent uploads lock rows in the same order.
    const rows = [...groups.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, group]) => group);

    await this.db.$executeRaw`
      INSERT INTO "ReceiptDailyCount" (
        "date", "agentId", "machineId", "receiptType", "transactionCategory",
        "transactionType", "status", "count", "amount",
        "firstTransactionAt", "lastTransactionAt", "updatedAt"
      )
      VALUES ${Prisma.join(
        rows.map(
          ({ date, receipt, count, amount, first, last }) => Prisma.sql`(
            ${date}::date,
            ${receipt.agentId},
            ${receipt.machineId},
            ${receipt.receiptType}::"ReceiptType",
            ${receipt.transactionCategory}::"TransactionCategory",
            ${receipt.transactionType},
            ${receipt.status}::"ReceiptStatus",
            ${count},
            ${amount.toString()}::numeric,
            ${first},
            ${last},
            CURRENT_TIMESTAMP
          )`,
        ),
      )}
      ON CONFLICT (
        "date", "agentId", "machineId", "receiptType", "transactionCategory",
        "transactionType", "status"
      ) DO UPDATE SET
        "count" = "ReceiptDailyCount"."count" + EXCLUDED."count",
        "amount" = "ReceiptDailyCount"."amount" + EXCLUDED."amount",
        "firstTransactionAt" = LEAST(
          "ReceiptDailyCount"."firstTransactionAt",
          EXCLUDED."firstTransactionAt"
        ),
        "lastTransactionAt" = GREATEST(
          "ReceiptDailyCount"."lastTransactionAt",
          EXCLUDED."lastTransactionAt"
        ),
        "updatedAt" = CURRENT_TIMESTAMP
    `;
  }

  /** IST days that have more receipts than counted (e.g. saved by old code). */
  async findUndercountedDays() {
    const rows = await this.db.$queryRaw<{ date: Date }[]>`
      SELECT DISTINCT r."date"
      FROM (${RECEIPT_GROUPS_SQL}) r
      LEFT JOIN "ReceiptDailyCount" c
        ON c."date" = r."date" AND c."agentId" = r."agentId"
        AND c."machineId" = r."machineId" AND c."receiptType" = r."receiptType"
        AND c."transactionCategory" = r."transactionCategory"
        AND c."transactionType" = r."transactionType" AND c."status" = r."status"
      WHERE r."count" > COALESCE(c."count", 0)
    `;

    return rows.map((row) => row.date);
  }

  /**
   * Raises the counts of the given days to what their receipts show. Never
   * lowers a count: a day whose receipts are partly deleted keeps its counts.
   * Run inside a transaction; returns the rows changed.
   */
  async repairDays(dates: Date[]) {
    if (dates.length === 0) {
      return 0;
    }

    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(${DAILY_COUNT_LOCK_KEY})`;

    const days = dates.map((date) => date.toISOString().slice(0, 10));

    return this.db.$executeRaw`
      INSERT INTO "ReceiptDailyCount" (
        "date", "agentId", "machineId", "receiptType", "transactionCategory",
        "transactionType", "status", "count", "amount",
        "firstTransactionAt", "lastTransactionAt", "updatedAt"
      )
      SELECT r.*, CURRENT_TIMESTAMP
      FROM (${RECEIPT_GROUPS_SQL}) r
      WHERE r."date" = ANY(${days}::date[])
      ON CONFLICT (
        "date", "agentId", "machineId", "receiptType", "transactionCategory",
        "transactionType", "status"
      ) DO UPDATE SET
        "count" = EXCLUDED."count",
        "amount" = EXCLUDED."amount",
        "firstTransactionAt" = LEAST(
          "ReceiptDailyCount"."firstTransactionAt",
          EXCLUDED."firstTransactionAt"
        ),
        "lastTransactionAt" = GREATEST(
          "ReceiptDailyCount"."lastTransactionAt",
          EXCLUDED."lastTransactionAt"
        ),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "ReceiptDailyCount"."count" < EXCLUDED."count"
    `;
  }

  /** Receipts older than the cutoff, by transaction time (else upload time). */
  async countReceiptsBefore(cutoff: Date) {
    return this.db.receipt.count({
      where: {
        OR: [
          { transactionAt: { lt: cutoff } },
          { transactionAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
  }

  /**
   * Deletes up to `limit` receipts older than the cutoff, oldest first, and
   * returns how many went. Oldest first, so a run that stops halfway leaves
   * whole recent days intact. Cash denominations cascade; float ledger rows stay and lose only
   * their receipt link.
   */
  async deleteReceiptsBefore(cutoff: Date, limit: number) {
    return this.db.$executeRaw`
      DELETE FROM "Receipt"
      WHERE "id" IN (
        SELECT "id" FROM "Receipt"
        WHERE "transactionAt" < ${cutoff}
          OR ("transactionAt" IS NULL AND "createdAt" < ${cutoff})
        ORDER BY "transactionAt" ASC NULLS FIRST
        LIMIT ${limit}
      )
    `;
  }

  async deleteCountsBefore(date: Date) {
    const result = await this.db.receiptDailyCount.deleteMany({
      where: { date: { lt: date } },
    });

    return result.count;
  }
}
