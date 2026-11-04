import { PrismaDb } from "../../core/database/prisma.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { istDateKey, istParts } from "../../core/utils/ist";
import { Prisma } from "../../generated/prisma/client";
import {
  AgentType,
  CommissionRateType,
  CommissionScope,
  ReceiptStatus,
  ReceiptType,
  TransactionCategory,
} from "../../generated/prisma/enums";

type Service = Prisma.CommissionServiceGetPayload<object>;
type Rate = Prisma.CommissionRateGetPayload<object>;

const D = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal) => Number(value.toFixed(2));

/** The service a receipt belongs to: its own receipt type first, else the category's. */
export function serviceOf(
  services: Service[],
  transactionCategory: TransactionCategory,
  receiptType: ReceiptType | null,
) {
  return (
    services.find((s) => s.transactionCategory === transactionCategory && s.receiptType === receiptType) ??
    services.find((s) => s.transactionCategory === transactionCategory && s.receiptType === null) ??
    null
  );
}

export function rateLabel(rate: Pick<Rate, "type" | "amount" | "percent" | "minAmount" | "maxAmount"> | null) {
  if (!rate || rate.type === CommissionRateType.INHERIT) {
    return null;
  }

  if (rate.type === CommissionRateType.FLAT) {
    return `₹${Number(rate.amount ?? 0)}`;
  }

  const limits = [
    rate.minAmount !== null ? `min ₹${Number(rate.minAmount)}` : null,
    rate.maxAmount !== null ? `max ₹${Number(rate.maxAmount)}` : null,
  ].filter(Boolean);

  return `${Number(rate.percent ?? 0)}%${limits.length ? ` (${limits.join(", ")})` : ""}`;
}

/**
 * Commission: the super admin sets a rate per service (FLAT ₹ or PERCENT of
 * the amount), for everyone (DEFAULT), a BC or one CSP. **Only the CSP
 * earns**: every successful receipt of the CSP or of its KOs earns for the
 * CSP (KOs are paid a salary by their CSP). The rate live at the receipt's
 * time is frozen on the receipt when it's uploaded and added to the daily
 * counts, so monthly totals survive receipt retention and rate changes never
 * rewrite the past.
 */
export default class CommissionService {
  constructor(private readonly db: PrismaDb) {}

  // ---------------------------------------------------------------------------
  // At upload
  // ---------------------------------------------------------------------------

  /** Commission for each receipt of one agent (null when it isn't part of a CSP). */
  async computeForReceipts(
    agentId: string,
    receipts: {
      transactionCategory: TransactionCategory;
      receiptType: ReceiptType;
      status: ReceiptStatus | null;
      amount?: number | Prisma.Decimal | null;
      transactionAt?: Date | null;
    }[],
  ) {
    const empty = receipts.map(() => ({ commissionAmount: null as Prisma.Decimal | null, commissionRateId: null as string | null }));
    const chain = await this.scopeChainOf(agentId);

    if (!chain) {
      return empty;
    }

    const [services, rates] = await Promise.all([
      this.db.commissionService.findMany({ where: { isActive: true } }),
      this.ratesOf(chain),
    ]);

    return receipts.map((receipt) => {
      const service = serviceOf(services, receipt.transactionCategory, receipt.receiptType);

      if (!service) {
        return { commissionAmount: null, commissionRateId: null };
      }

      if (receipt.status !== ReceiptStatus.SUCCESS) {
        return { commissionAmount: D(0), commissionRateId: null };
      }

      const rate = this.rateAt(rates, service.id, chain, receipt.transactionAt ?? new Date());

      return { commissionAmount: this.amountOf(rate, receipt.amount), commissionRateId: rate?.id ?? null };
    });
  }

  // ---------------------------------------------------------------------------
  // App: summary, months, rates
  // ---------------------------------------------------------------------------

  /**
   * Commission of the agents for a period (IST): TODAY, WEEK (Monday → today),
   * MONTH (1st → today) or a whole `month` (YYYY-MM). From the daily counts.
   */
  async summary(input: {
    agentIds: string[];
    period: "TODAY" | "WEEK" | "MONTH";
    month?: string;
    rateCspAgentId?: string | null;
  }) {
    const now = new Date();
    const range = rangeOf(input.period, input.month, now);
    const previous = previousRangeOf(input.period, input.month, now);
    const monthRange = rangeOf("MONTH", undefined, now);

    const [services, rows, previousTotal, monthTotal, agents, rates] = await Promise.all([
      this.db.commissionService.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
      this.db.receiptDailyCount.groupBy({
        by: ["agentId", "transactionCategory", "receiptType", "status"],
        where: { agentId: { in: input.agentIds }, date: { gte: range.fromDate, lte: range.toDate } },
        _sum: { count: true, amount: true, commissionAmount: true },
      }),
      this.totalBetween(input.agentIds, previous.fromDate, previous.toDate),
      this.totalBetween(input.agentIds, monthRange.fromDate, monthRange.toDate),
      this.db.agent.findMany({ where: { agentId: { in: input.agentIds } }, select: { agentId: true, name: true, type: true } }),
      input.rateCspAgentId ? this.liveRates(input.rateCspAgentId) : Promise.resolve(null),
    ]);

    const byService = new Map<string, { count: number; amount: Prisma.Decimal }>();
    const byAgent = new Map<string, Prisma.Decimal>();
    let total = D(0);
    let successCount = 0;
    let failedCount = 0;
    let updatedAt: Date | null = null;

    for (const row of rows) {
      const count = row._sum.count ?? 0;

      if (row.status !== ReceiptStatus.SUCCESS) {
        if (row.status === ReceiptStatus.FAILED) failedCount += count;
        continue;
      }

      const service = serviceOf(services, row.transactionCategory, row.receiptType);
      const commission = D(row._sum.commissionAmount ?? 0);

      successCount += count;
      total = total.plus(commission);
      byAgent.set(row.agentId, (byAgent.get(row.agentId) ?? D(0)).plus(commission));

      if (service) {
        const entry = byService.get(service.id) ?? { count: 0, amount: D(0) };

        entry.count += count;
        entry.amount = entry.amount.plus(commission);
        byService.set(service.id, entry);
      }
    }

    const groups = { FINANCIAL: D(0), NON_FINANCIAL: D(0), ENROLMENT: D(0) };
    const rateByCode = new Map((rates?.rates ?? []).map((rate) => [rate.serviceCode, rate]));

    const serviceRows = services.map((service) => {
      const entry = byService.get(service.id) ?? { count: 0, amount: D(0) };
      const rate = rateByCode.get(service.code);

      groups[service.group] = groups[service.group].plus(entry.amount);

      return {
        serviceCode: service.code,
        serviceName: service.name,
        transactionCategory: service.transactionCategory,
        receiptType: service.receiptType,
        group: service.group,
        count: entry.count,
        rateType: rate?.rateType ?? null,
        rate: rate?.rate ?? null,
        rateLabel: rate?.rateLabel ?? null,
        amount: money(entry.amount),
      };
    });

    const names = new Map(agents.map((agent) => [agent.agentId, agent]));

    if (rows.length > 0) {
      updatedAt = new Date();
    }

    return {
      period: input.month ? "MONTH" : input.period,
      month: input.month ?? null,
      from: range.fromKey,
      to: range.toKey,
      total: money(total),
      previousTotal: money(previousTotal),
      monthToDate: money(monthTotal),
      successCount,
      excludedFailedCount: failedCount,
      groups: {
        FINANCIAL: money(groups.FINANCIAL),
        NON_FINANCIAL: money(groups.NON_FINANCIAL),
        ENROLMENT: money(groups.ENROLMENT),
      },
      rows: serviceRows,
      // Where the commission was generated; all of it is the CSP's.
      byAgent: [...byAgent.entries()]
        .map(([agentId, amount]) => ({
          agentId,
          name: names.get(agentId)?.name ?? null,
          type: names.get(agentId)?.type ?? null,
          amount: money(amount),
        }))
        .sort((a, b) => b.amount - a.amount),
      updatedAt,
    };
  }

  /** Monthly totals (the CSP's monthly earnings), newest first. Counts are kept a year. */
  async months(agentIds: string[], count = 12) {
    const now = new Date();
    const { year, month } = istParts(now);
    const keys: string[] = [];

    for (let i = 0; i < count; i++) {
      const date = new Date(Date.UTC(year, month - i, 1));

      keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
    }

    const oldest = rangeOf("MONTH", keys[keys.length - 1], now);
    const rows = await this.db.$queryRaw<{ month: string; amount: Prisma.Decimal; count: number }[]>`
      SELECT to_char("date", 'YYYY-MM') AS "month",
             COALESCE(SUM("commissionAmount"), 0) AS "amount",
             COALESCE(SUM("count"), 0)::int AS "count"
      FROM "ReceiptDailyCount"
      WHERE "agentId" = ANY(${agentIds}::text[]) AND "status" = 'SUCCESS'
        AND "date" >= ${oldest.fromDate}::date
      GROUP BY 1
    `;
    const byMonth = new Map(rows.map((row) => [row.month, row]));

    return keys.map((key) => ({
      month: key,
      total: money(D(byMonth.get(key)?.amount ?? 0)),
      successCount: byMonth.get(key)?.count ?? 0,
      isCurrent: key === keys[0],
    }));
  }

  /** The live rate of every active service for one CSP (after precedence). */
  async liveRates(cspAgentId: string) {
    const chain = await this.scopeChainOf(cspAgentId);

    if (!chain) {
      throw new BadRequestError("This agent isn't part of a CSP.");
    }

    const now = new Date();
    const [services, rates] = await Promise.all([
      this.db.commissionService.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
      this.ratesOf(chain),
    ]);

    let effectiveFrom: Date | null = null;

    const list = services.map((service) => {
      const rate = this.rateAt(rates, service.id, chain, now);

      if (rate && (!effectiveFrom || rate.effectiveFrom > effectiveFrom)) {
        effectiveFrom = rate.effectiveFrom;
      }

      return {
        serviceCode: service.code,
        serviceName: service.name,
        transactionCategory: service.transactionCategory,
        receiptType: service.receiptType,
        group: service.group,
        rateType: rate?.type ?? null,
        rate: rate ? (rate.type === CommissionRateType.FLAT ? Number(rate.amount ?? 0) : Number(rate.percent ?? 0)) : null,
        minAmount: rate?.minAmount !== null && rate?.minAmount !== undefined ? Number(rate.minAmount) : null,
        maxAmount: rate?.maxAmount !== null && rate?.maxAmount !== undefined ? Number(rate.maxAmount) : null,
        rateLabel: rateLabel(rate),
        scope: rate?.scope ?? null,
        unit: service.group === "ENROLMENT" ? "ENROLMENT" : "TRANSACTION",
      };
    });

    return { cspAgentId, effectiveFrom, rates: list };
  }

  // ---------------------------------------------------------------------------
  // Super admin
  // ---------------------------------------------------------------------------

  listServices() {
    return this.db.commissionService.findMany({ orderBy: { sortOrder: "asc" } });
  }

  async updateService(code: string, change: { name?: string; isActive?: boolean; sortOrder?: number }) {
    const service = await this.db.commissionService.findUnique({ where: { code } });

    if (!service) {
      throw new NotFoundError("Service not found.");
    }

    return this.db.commissionService.update({ where: { id: service.id }, data: change });
  }

  /** Rates of one scope: per service the live one and the next one, if any. */
  async ratesForScope(scope: CommissionScope, scopeId: string) {
    const now = new Date();
    const [services, rates] = await Promise.all([
      this.db.commissionService.findMany({ orderBy: { sortOrder: "asc" } }),
      this.db.commissionRate.findMany({ where: { scope, scopeId }, orderBy: { effectiveFrom: "asc" } }),
    ]);

    return services.map((service) => {
      const own = rates.filter((rate) => rate.serviceId === service.id);
      const live = [...own].reverse().find((rate) => rate.effectiveFrom <= now) ?? null;
      const next = own.find((rate) => rate.effectiveFrom > now) ?? null;

      return {
        serviceCode: service.code,
        serviceName: service.name,
        group: service.group,
        isActive: service.isActive,
        live: live ? this.mapRate(live) : null,
        next: next ? this.mapRate(next) : null,
      };
    });
  }

  async history(filter: { serviceCode?: string; scope?: CommissionScope; scopeId?: string }) {
    const rates = await this.db.commissionRate.findMany({
      where: {
        ...(filter.serviceCode && { service: { code: filter.serviceCode } }),
        ...(filter.scope && { scope: filter.scope }),
        ...(filter.scopeId !== undefined && { scopeId: filter.scopeId }),
      },
      include: { service: { select: { code: true, name: true } } },
      orderBy: { effectiveFrom: "desc" },
      take: 500,
    });

    return rates.map((rate) => ({ ...this.mapRate(rate), serviceCode: rate.service.code, serviceName: rate.service.name }));
  }

  /**
   * A new rate from `effectiveFrom` (now or later; never in the past, so
   * saved receipts keep theirs). It replaces the scope's rate from then on.
   */
  async setRate(input: {
    serviceCode: string;
    scope: CommissionScope;
    scopeId?: string;
    type: CommissionRateType;
    amount?: number;
    percent?: number;
    minAmount?: number;
    maxAmount?: number;
    effectiveFrom?: Date;
    reason?: string;
    createdBy: string;
  }) {
    const service = await this.db.commissionService.findUnique({ where: { code: input.serviceCode } });

    if (!service) {
      throw new NotFoundError("Service not found.");
    }

    const scopeId = input.scope === CommissionScope.DEFAULT ? "" : (input.scopeId ?? "").trim();

    if (input.scope !== CommissionScope.DEFAULT && !scopeId) {
      throw new BadRequestError("scopeId is required for a BC or CSP rate.");
    }

    if (input.scope === CommissionScope.BC) {
      const bc = await this.db.businessCorrespondent.findUnique({ where: { bcId: scopeId }, select: { bcId: true } });

      if (!bc) throw new NotFoundError("BC not found.");
    }

    if (input.scope === CommissionScope.CSP) {
      const csp = await this.db.agent.findFirst({ where: { agentId: scopeId, type: AgentType.CSP }, select: { agentId: true } });

      if (!csp) throw new NotFoundError("CSP not found.");
    }

    if (input.scope === CommissionScope.DEFAULT && input.type === CommissionRateType.INHERIT) {
      throw new BadRequestError("The default rate can't inherit: set FLAT or PERCENT.");
    }

    if (input.type === CommissionRateType.FLAT && input.amount === undefined) {
      throw new BadRequestError("amount is required for a FLAT rate.");
    }

    if (input.type === CommissionRateType.PERCENT && input.percent === undefined) {
      throw new BadRequestError("percent is required for a PERCENT rate.");
    }

    if (input.minAmount !== undefined && input.maxAmount !== undefined && input.minAmount > input.maxAmount) {
      throw new BadRequestError("minAmount can't be more than maxAmount.");
    }

    const now = new Date();
    const effectiveFrom = input.effectiveFrom ?? now;

    if (effectiveFrom.getTime() < now.getTime() - 60_000) {
      throw new BadRequestError("effectiveFrom can't be in the past: saved receipts keep the rate they were saved with.");
    }

    const rate = await this.db.commissionRate.create({
      data: {
        serviceId: service.id,
        scope: input.scope,
        scopeId,
        type: input.type,
        amount: input.type === CommissionRateType.FLAT ? input.amount : null,
        percent: input.type === CommissionRateType.PERCENT ? input.percent : null,
        minAmount: input.type === CommissionRateType.PERCENT ? input.minAmount ?? null : null,
        maxAmount: input.type === CommissionRateType.PERCENT ? input.maxAmount ?? null : null,
        effectiveFrom,
        reason: input.reason,
        createdBy: input.createdBy,
      },
    });

    return { ...this.mapRate(rate), serviceCode: service.code, serviceName: service.name };
  }

  /** Only a rate that hasn't started yet can be removed. */
  async deleteRate(rateId: string) {
    const rate = await this.db.commissionRate.findUnique({ where: { id: rateId } });

    if (!rate) {
      throw new NotFoundError("Rate not found.");
    }

    if (rate.effectiveFrom <= new Date()) {
      throw new BadRequestError("This rate is already in use; set a new rate instead.");
    }

    await this.db.commissionRate.delete({ where: { id: rate.id } });
  }

  // ---------------------------------------------------------------------------

  /** CSP of the agent and its BC: the scopes, most specific first. */
  private async scopeChainOf(agentId: string) {
    const agent = await this.db.agent.findUnique({
      where: { agentId },
      select: { agentId: true, type: true, parentAgentId: true, bcId: true, parentAgent: { select: { bcId: true } } },
    });

    if (!agent) return null;

    const cspAgentId = agent.type === AgentType.CSP ? agent.agentId : agent.type === AgentType.KO ? agent.parentAgentId : null;

    if (!cspAgentId) return null;

    const bcId = agent.type === AgentType.CSP ? agent.bcId : agent.parentAgent?.bcId ?? null;

    return [
      { scope: CommissionScope.CSP, scopeId: cspAgentId },
      ...(bcId ? [{ scope: CommissionScope.BC, scopeId: bcId }] : []),
      { scope: CommissionScope.DEFAULT, scopeId: "" },
    ];
  }

  private ratesOf(chain: { scope: CommissionScope; scopeId: string }[]) {
    return this.db.commissionRate.findMany({
      where: { OR: chain.map((link) => ({ scope: link.scope, scopeId: link.scopeId })) },
      orderBy: { effectiveFrom: "asc" },
    });
  }

  /** The rate at `at`: the most specific scope with a rate then (INHERIT skips a scope). */
  private rateAt(rates: Rate[], serviceId: string, chain: { scope: CommissionScope; scopeId: string }[], at: Date) {
    for (const link of chain) {
      const live = rates
        .filter((rate) => rate.serviceId === serviceId && rate.scope === link.scope && rate.scopeId === link.scopeId && rate.effectiveFrom <= at)
        .at(-1);

      if (live && live.type !== CommissionRateType.INHERIT) {
        return live;
      }
    }

    return null;
  }

  private amountOf(rate: Rate | null, amount: number | Prisma.Decimal | null | undefined) {
    if (!rate) return D(0);

    if (rate.type === CommissionRateType.FLAT) return D(rate.amount ?? 0);

    let value = D(amount ?? 0).times(D(rate.percent ?? 0)).dividedBy(100);

    if (rate.minAmount !== null && value.lessThan(rate.minAmount)) value = D(rate.minAmount);
    if (rate.maxAmount !== null && value.greaterThan(rate.maxAmount)) value = D(rate.maxAmount);

    return value.toDecimalPlaces(2);
  }

  private async totalBetween(agentIds: string[], fromDate: Date, toDate: Date) {
    const result = await this.db.receiptDailyCount.aggregate({
      where: { agentId: { in: agentIds }, status: ReceiptStatus.SUCCESS, date: { gte: fromDate, lte: toDate } },
      _sum: { commissionAmount: true },
    });

    return D(result._sum.commissionAmount ?? 0);
  }

  mapRate(rate: Rate) {
    return {
      id: rate.id,
      scope: rate.scope,
      scopeId: rate.scopeId || null,
      type: rate.type,
      amount: rate.amount === null ? null : Number(rate.amount),
      percent: rate.percent === null ? null : Number(rate.percent),
      minAmount: rate.minAmount === null ? null : Number(rate.minAmount),
      maxAmount: rate.maxAmount === null ? null : Number(rate.maxAmount),
      rateLabel: rateLabel(rate),
      effectiveFrom: rate.effectiveFrom,
      reason: rate.reason,
      createdBy: rate.createdBy,
      createdAt: rate.createdAt,
    };
  }
}

/** IST calendar dates (@db.Date values) and their keys for a period. */
function rangeOf(period: "TODAY" | "WEEK" | "MONTH", month: string | undefined, now: Date) {
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const lastDay = new Date(Date.UTC(y, m, 0));
    const today = new Date(`${istDateKey(now)}T00:00:00.000Z`);
    const to = lastDay > today ? today : lastDay;

    return { fromDate: from, toDate: to, fromKey: key(from), toKey: key(to) };
  }

  const today = new Date(`${istDateKey(now)}T00:00:00.000Z`);
  let from = today;

  if (period === "WEEK") {
    const weekday = (today.getUTCDay() + 6) % 7; // Monday = 0

    from = new Date(today.getTime() - weekday * 86_400_000);
  } else if (period === "MONTH") {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  }

  return { fromDate: from, toDate: today, fromKey: key(from), toKey: key(today) };
}

/** The same period one step back (yesterday / last week / last month to the same day). */
function previousRangeOf(period: "TODAY" | "WEEK" | "MONTH", month: string | undefined, now: Date) {
  const current = rangeOf(period, month, now);

  if (month || period === "MONTH") {
    const from = new Date(Date.UTC(current.fromDate.getUTCFullYear(), current.fromDate.getUTCMonth() - 1, 1));
    const lastDay = new Date(Date.UTC(current.fromDate.getUTCFullYear(), current.fromDate.getUTCMonth(), 0));
    const sameDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), current.toDate.getUTCDate()));
    const to = month ? lastDay : sameDay > lastDay ? lastDay : sameDay;

    return { fromDate: from, toDate: to };
  }

  const days = period === "WEEK" ? 7 : 1;

  return {
    fromDate: new Date(current.fromDate.getTime() - days * 86_400_000),
    toDate: new Date(current.toDate.getTime() - days * 86_400_000),
  };
}

const key = (date: Date) => date.toISOString().slice(0, 10);
