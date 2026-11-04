import { PrismaDb } from "../../core/database/prisma.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ConflictError } from "../../core/errors/ConflictError";
import {
  addDays,
  fromIstCalendarDate,
  istCalendarDate,
  istDateKey,
} from "../../core/utils/ist";
import { Prisma } from "../../generated/prisma/client";
import { CashActorType, CashLedgerType } from "../../generated/prisma/enums";

import { Drawer, drawerOf, drawerTotal } from "./cash.constants";
import { D, NOT_SET_UP_MESSAGE, money, rupees } from "./cash.helpers";

/** "₹500" for whole rupees, "₹500.50" otherwise (the desktop's wording). */
const amountText = (value: Prisma.Decimal) =>
  value.isInteger() ? `₹${value.toFixed(0)}` : rupees(value);
import CashRepository from "./cash.repository";

type DayClose = Prisma.CashDayCloseGetPayload<object>;

const DEFAULT_DAYS = 14;
const MAX_DAYS = 92;

export function mapDayClose(close: DayClose) {
  return {
    dayId: close.id,
    agentId: close.agentId,
    date: close.date.toISOString().slice(0, 10),
    system: { cashInHand: money(D(close.systemCashInHand)), drawer: close.systemDrawer },
    counted: { cashInHand: money(D(close.countedCashInHand)), drawer: close.countedDrawer },
    difference: money(D(close.difference)),
    closedAt: close.closedAt,
  };
}

/** `YYYY-MM-DD` (IST) → the @db.Date value. */
export function calendarDateOf(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

/**
 * Close the day (the agent's end-of-day count, side by side with the
 * system's drawer) and the list of days for the History tab. IST days.
 * Closing never changes the balances: a difference is fixed through a
 * correction request.
 */
export default class CashDayService {
  private readonly repository: CashRepository;

  constructor(private readonly db: PrismaDb) {
    this.repository = new CashRepository(db);
  }

  async closeDay(input: {
    agentId: string;
    countedCashInHand: number;
    countedDrawer: Drawer;
    machineCode: string;
  }) {
    const cspAgentId = await this.repository.findPoolCspId(input.agentId);

    if (!cspAgentId) {
      throw new BadRequestError("This agent isn't part of a CSP.");
    }

    const pool = await this.repository.lockPool(cspAgentId);

    if (!pool) {
      throw new BadRequestError(NOT_SET_UP_MESSAGE);
    }

    const counted = drawerOf(input.countedDrawer);
    const countedHand = D(input.countedCashInHand);
    const countedTotal = D(drawerTotal(counted));

    if (!countedHand.equals(countedTotal)) {
      throw new BadRequestError(
        `The cash in hand you entered (${rupees(countedHand)}) must equal the notes counted (${rupees(countedTotal)}).`,
      );
    }

    const now = new Date();
    const date = istCalendarDate(now);

    const existing = await this.db.cashDayClose.findUnique({
      where: { agentId_date: { agentId: input.agentId, date } },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictError("Today is already closed.");
    }

    const cash = await this.repository.lockAgentCash([input.agentId]);
    const current = cash.get(input.agentId)!;
    const difference = countedHand.minus(current.cashInHand);

    const close = await this.db.cashDayClose.create({
      data: {
        cspAgentId,
        agentId: input.agentId,
        date,
        systemCashInHand: current.cashInHand,
        systemDrawer: current.drawer,
        countedCashInHand: countedHand,
        countedDrawer: counted,
        difference,
        machineCode: input.machineCode,
        closedAt: now,
      },
    });

    await this.repository.createLedger([
      {
        cspAgentId,
        agentId: input.agentId,
        type: CashLedgerType.DAY_CLOSE,
        amount: countedHand,
        balanceCashInHand: current.cashInHand,
        actorType: CashActorType.MACHINE,
        actorId: input.machineCode,
        remarks: this.differenceText(difference),
      },
    ]);

    return { close: mapDayClose(close), message: this.messageOf(difference) };
  }

  async getDayClose(agentId: string, key: string) {
    const close = await this.db.cashDayClose.findUnique({
      where: { agentId_date: { agentId, date: calendarDateOf(key) } },
    });

    return close ? mapDayClose(close) : null;
  }

  /**
   * The agent's days, newest first: OPEN (today), CLOSED, NOT_CLOSED (a
   * past day nobody closed; worked out here, no job). Days before the agent
   * existed are left out. Default: the last 14 days; at most 92 per call.
   */
  async listDays(agentId: string, range: { from?: string; to?: string }) {
    const today = istDateKey(new Date());
    const to = range.to && range.to < today ? range.to : today;
    const from = range.from ?? istDateKey(addDays(fromIstCalendarDate(calendarDateOf(to)), -(DEFAULT_DAYS - 1)));

    if (from > to) {
      throw new BadRequestError("`from` must be on or before `to`.");
    }

    const span = Math.round((calendarDateOf(to).getTime() - calendarDateOf(from).getTime()) / 86_400_000) + 1;

    if (span > MAX_DAYS) {
      throw new BadRequestError(`Ask for at most ${MAX_DAYS} days at a time.`);
    }

    const [agent, closes] = await Promise.all([
      this.db.agent.findUnique({ where: { agentId }, select: { createdAt: true } }),
      this.db.cashDayClose.findMany({
        where: { agentId, date: { gte: calendarDateOf(from), lte: calendarDateOf(to) } },
      }),
    ]);

    const firstDay = agent ? istDateKey(agent.createdAt) : from;
    const byDate = new Map(closes.map((close) => [close.date.toISOString().slice(0, 10), close]));
    const days = [];

    for (let i = 0; i < span; i++) {
      const date = new Date(calendarDateOf(to).getTime() - i * 86_400_000).toISOString().slice(0, 10);

      if (date < firstDay) {
        break;
      }

      const close = byDate.get(date);

      days.push({
        date,
        status: close ? "CLOSED" : date === today ? "OPEN" : "NOT_CLOSED",
        closedAt: close?.closedAt ?? null,
        difference: close ? money(D(close.difference)) : null,
      });
    }

    return days;
  }

  /** CSP app: the agents' closes in a range, and today's state per agent. */
  async listForCsp(input: {
    agents: { agentId: string; name: string }[];
    from?: string;
    to?: string;
  }) {
    const today = istDateKey(new Date());
    const to = input.to ?? today;
    const from = input.from ?? istDateKey(addDays(fromIstCalendarDate(calendarDateOf(to)), -(DEFAULT_DAYS - 1)));
    const agentIds = input.agents.map((agent) => agent.agentId);
    const names = new Map(input.agents.map((agent) => [agent.agentId, agent.name]));

    const closes = await this.db.cashDayClose.findMany({
      where: {
        agentId: { in: agentIds },
        date: { gte: calendarDateOf(from), lte: calendarDateOf(to) },
      },
      orderBy: [{ date: "desc" }, { agentId: "asc" }],
    });

    const closedToday = new Set(
      closes
        .filter((close) => close.date.toISOString().slice(0, 10) === today)
        .map((close) => close.agentId),
    );

    return {
      today: input.agents.map((agent) => ({
        agentId: agent.agentId,
        agentName: agent.name,
        status: closedToday.has(agent.agentId) ? "CLOSED" : "OPEN",
      })),
      items: closes.map((close) => ({
        ...mapDayClose(close),
        agentName: names.get(close.agentId) ?? null,
        result: this.differenceText(D(close.difference)),
      })),
    };
  }

  private differenceText(difference: Prisma.Decimal) {
    if (difference.isZero()) {
      return "Matched";
    }

    return `${amountText(difference.abs())} ${difference.isNegative() ? "short" : "over"}`;
  }

  private messageOf(difference: Prisma.Decimal) {
    if (difference.isZero()) {
      return "Day closed. The count matches.";
    }

    return `Day closed. You're ${amountText(difference.abs())} ${difference.isNegative() ? "short" : "over"}.`;
  }
}
