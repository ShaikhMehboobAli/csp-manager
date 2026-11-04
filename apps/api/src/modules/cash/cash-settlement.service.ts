import { PrismaDb } from "../../core/database/prisma.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ConflictError } from "../../core/errors/ConflictError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { endOfIstDay, istCalendarDate, istDateKey, startOfIstDay } from "../../core/utils/ist";
import { Prisma } from "../../generated/prisma/client";
import {
  AgentType,
  CashActorType,
  CashLedgerType,
  CashSettlementDirection,
  CashSettlementStatus,
  CashSettlementStep,
  TransactionCategory,
} from "../../generated/prisma/enums";

import { DRAWER_KEYS, Drawer, drawerOf, drawerTotal, emptyDrawer } from "./cash.constants";
import { mapDayClose } from "./cash-day.service";
import CashDeskService from "./cash-desk.service";
import {
  D,
  NOT_SET_UP_MESSAGE,
  ZERO,
  money,
  moveDrawer,
  rupees,
} from "./cash.helpers";
import CashRepository, { LockedPool } from "./cash.repository";

type Settlement = Prisma.CashSettlementGetPayload<object>;

const STEP_LABEL: Record<CashSettlementDirection, Record<CashSettlementStep, string>> = {
  ACCOUNT_TO_HAND: {
    TO_BANK: "Cash in account → bank",
    FROM_BANK: "Bank → cash in hand",
  },
  HAND_TO_ACCOUNT: {
    TO_BANK: "Cash in hand → bank",
    FROM_BANK: "Bank → cash in account",
  },
  // One step only (FROM_BANK).
  BANK_TO_HAND: {
    TO_BANK: "Left in bank",
    FROM_BANK: "Left in bank → cash in hand",
  },
};

/** Step 2 delivering notes into the drawer: approved with the counted notes. */
const TO_DRAWER: CashSettlementDirection[] = [
  CashSettlementDirection.ACCOUNT_TO_HAND,
  CashSettlementDirection.BANK_TO_HAND,
];

/**
 * A KO's own settlements, from the desktop. Each direction has two steps,
 * both approved by the KO itself (the CSP is only informed):
 *
 *   ACCOUNT_TO_HAND: 1. cash in account → bank (amount)
 *                    2. bank → cash in hand (counted notes ≤ amount)
 *   HAND_TO_ACCOUNT: 1. cash in hand → bank (amount + notes taken out)
 *                    2. bank → cash in account (amount credited ≤ amount)
 *   BANK_TO_HAND:    only step 2: left in bank → cash in hand (counted
 *                    notes ≤ amount); created from cash left in bank
 *
 * Whatever step 2 doesn't deliver stays left in bank (CashPool.cashLeftInBank).
 * Creating step 1 takes the amount out at once and holds it "in bank"
 * (CashPool.cashInTransit), so other KOs see the lower cash in account.
 * Approving step 1 opens step 2. Cancelling an open step puts the money (and
 * notes) back. Always: cash in account + all cash in hand + in bank + left in bank =
 * limit. One open settlement per agent.
 */
export default class CashSettlementService {
  private readonly repository: CashRepository;

  constructor(private readonly db: PrismaDb) {
    this.repository = new CashRepository(db);
  }

  async create(input: {
    agentId: string;
    direction: CashSettlementDirection;
    amount: number;
    drawer?: Partial<Drawer>;
    remarks?: string;
    machineCode: string;
  }) {
    const { cspAgentId, pool } = await this.lockPoolOf(input.agentId);

    // One open settlement per agent; the pool lock serializes this check.
    const open = await this.db.cashSettlement.findFirst({
      where: { agentId: input.agentId, status: CashSettlementStatus.PENDING },
      select: { id: true },
    });

    if (open) {
      throw new ConflictError(
        "This agent already has an open settlement. Approve or cancel it first.",
      );
    }

    if (input.direction === CashSettlementDirection.BANK_TO_HAND) {
      return this.createFromLeftInBank({ ...input, cspAgentId, pool });
    }

    const cash = await this.repository.lockAgentCash([input.agentId]);
    const current = cash.get(input.agentId)!;
    const amount = D(input.amount);
    const toHand = input.direction === CashSettlementDirection.ACCOUNT_TO_HAND;

    let hand = current.cashInHand;
    let account = pool.cashInAccount;
    let drawer = current.drawer;
    let drawerChange: Partial<Drawer> | null = null;
    let notes: Drawer | null = null;

    if (toHand) {
      if (account.lessThan(amount)) {
        throw new BadRequestError(
          `Not enough cash in account: ${rupees(account)} available, ${rupees(amount)} requested.`,
        );
      }

      account = account.minus(amount);
    } else {
      if (hand.lessThan(amount)) {
        throw new BadRequestError(
          `Not enough cash in hand: ${rupees(hand)} available, ${rupees(amount)} requested.`,
        );
      }

      if (!input.drawer) {
        throw new BadRequestError(
          "Cash denomination is required: the notes taken out of the drawer.",
        );
      }

      notes = drawerOf(input.drawer);

      if (!D(drawerTotal(notes)).equals(amount)) {
        throw new BadRequestError(
          `Cash denomination total (₹${drawerTotal(notes).toFixed(2)}) must equal the amount (${rupees(amount)}).`,
        );
      }

      hand = hand.minus(amount);

      const moved = moveDrawer(drawer, notes, -1);

      drawer = moved.drawer;
      drawerChange = moved.change;
    }

    const transit = pool.cashInTransit.plus(amount);

    await this.repository.updatePool(cspAgentId, {
      cashInAccount: account,
      cashInTransit: transit,
    });

    if (!toHand) {
      await this.repository.updateAgentCash(input.agentId, hand, drawer);
    }

    const settlement = await this.db.cashSettlement.create({
      data: {
        cspAgentId,
        agentId: input.agentId,
        direction: input.direction,
        step: CashSettlementStep.TO_BANK,
        amount,
        drawer: notes ?? undefined,
        remarks: input.remarks,
        requestedBy: input.machineCode,
      },
    });

    await this.writeLedger(settlement, pool, {
      type: CashLedgerType.SETTLEMENT_TO_BANK,
      handChange: toHand ? ZERO : amount.negated(),
      accountChange: toHand ? amount.negated() : ZERO,
      transitChange: amount,
      leftInBankChange: ZERO,
      hand,
      account,
      transit,
      leftInBank: pool.cashLeftInBank,
      drawerChange,
      remarks: input.remarks ?? STEP_LABEL[input.direction].TO_BANK,
    });

    await this.repository.refreshFloatMirror(cspAgentId);

    return this.map(settlement);
  }

  /**
   * BANK_TO_HAND: holds the amount out of cash left in bank and opens the
   * bank → cash in hand step directly (approved with the counted notes).
   */
  private async createFromLeftInBank(input: {
    agentId: string;
    amount: number;
    remarks?: string;
    machineCode: string;
    cspAgentId: string;
    pool: LockedPool;
  }) {
    const { cspAgentId, pool } = input;
    const amount = D(input.amount);

    if (pool.cashLeftInBank.lessThan(amount)) {
      throw new BadRequestError(
        `Not enough cash left in bank: ${rupees(pool.cashLeftInBank)} available, ${rupees(amount)} requested.`,
      );
    }

    const cash = await this.repository.lockAgentCash([input.agentId]);
    const current = cash.get(input.agentId)!;
    const leftInBank = pool.cashLeftInBank.minus(amount);
    const transit = pool.cashInTransit.plus(amount);

    await this.repository.updatePool(cspAgentId, {
      cashInTransit: transit,
      cashLeftInBank: leftInBank,
    });

    const settlement = await this.db.cashSettlement.create({
      data: {
        cspAgentId,
        agentId: input.agentId,
        direction: CashSettlementDirection.BANK_TO_HAND,
        step: CashSettlementStep.FROM_BANK,
        amount,
        remarks: input.remarks,
        requestedBy: input.machineCode,
      },
    });

    await this.writeLedger(settlement, pool, {
      type: CashLedgerType.SETTLEMENT_HELD,
      handChange: ZERO,
      accountChange: ZERO,
      transitChange: amount,
      leftInBankChange: amount.negated(),
      hand: current.cashInHand,
      account: pool.cashInAccount,
      transit,
      leftInBank,
      drawerChange: null,
      remarks: input.remarks ?? STEP_LABEL.BANK_TO_HAND.FROM_BANK,
    });

    await this.repository.refreshFloatMirror(cspAgentId);

    return this.map(settlement);
  }

  /**
   * Approves an open step of the agent's own settlement. Step 1 opens step
   * 2. Step 2 may deliver less than the amount (ACCOUNT_TO_HAND: the counted
   * notes; HAND_TO_ACCOUNT: `amount`); the rest is left in bank.
   */
  async approve(input: {
    agentId: string;
    settlementId: string;
    drawer?: Partial<Drawer>;
    amount?: number;
    remarks?: string;
    machineCode: string;
  }) {
    const { cspAgentId, pool } = await this.lockPoolOf(input.agentId);
    const settlement = await this.lockOpenSettlement(input.agentId, input.settlementId);
    const review = { reviewedBy: input.machineCode, reviewedAt: new Date() };

    if (settlement.step === CashSettlementStep.TO_BANK) {
      // The money stays in bank; the next step delivers it.
      await this.db.cashSettlement.update({
        where: { id: settlement.id },
        data: { status: CashSettlementStatus.APPROVED, ...review },
      });

      const next = await this.db.cashSettlement.create({
        data: {
          cspAgentId,
          agentId: settlement.agentId,
          direction: settlement.direction,
          step: CashSettlementStep.FROM_BANK,
          amount: settlement.amount,
          parentId: settlement.id,
          requestedBy: input.machineCode,
        },
      });

      const approved = { ...settlement, status: CashSettlementStatus.APPROVED, ...review };

      return { approved: this.map(approved), next: this.map(next, approved) };
    }

    const cash = await this.repository.lockAgentCash([settlement.agentId]);
    const current = cash.get(settlement.agentId)!;
    const amount = D(settlement.amount);
    const transit = pool.cashInTransit.minus(amount);

    let hand = current.cashInHand;
    let account = pool.cashInAccount;
    let drawer = current.drawer;
    let drawerChange: Partial<Drawer> | null = null;
    let settled = amount;
    let notes: Drawer | null = null;

    if (TO_DRAWER.includes(settlement.direction)) {
      if (!input.drawer) {
        throw new BadRequestError(
          "Cash denomination is required: the notes received from the bank.",
        );
      }

      notes = drawerOf(input.drawer);
      settled = D(drawerTotal(notes));

      if (settled.isZero() || settled.greaterThan(amount)) {
        throw new BadRequestError(
          `Cash denomination total (${rupees(settled)}) must be more than ₹0 and at most the amount in bank (${rupees(amount)}).`,
        );
      }

      hand = hand.plus(settled);

      const moved = moveDrawer(drawer, notes, 1);

      drawer = moved.drawer;
      drawerChange = moved.change;

      await this.repository.updateAgentCash(settlement.agentId, hand, drawer);
    } else {
      settled = input.amount !== undefined ? D(input.amount) : amount;

      if (settled.isZero() || settled.greaterThan(amount)) {
        throw new BadRequestError(
          `Amount credited (${rupees(settled)}) must be more than ₹0 and at most the amount in bank (${rupees(amount)}).`,
        );
      }

      account = account.plus(settled);
    }

    // Whatever didn't reach the destination stays in bank, shown separately.
    const leftInBank = pool.cashLeftInBank.plus(amount.minus(settled));

    await this.repository.updatePool(cspAgentId, {
      cashInAccount: account,
      cashInTransit: transit,
      cashLeftInBank: leftInBank,
    });

    const updated = await this.db.cashSettlement.update({
      where: { id: settlement.id },
      data: {
        status: CashSettlementStatus.APPROVED,
        settledAmount: settled,
        drawer: notes ?? undefined,
        remarks: input.remarks ?? settlement.remarks,
        ...review,
      },
    });

    await this.writeLedger(updated, pool, {
      type: CashLedgerType.SETTLEMENT_FROM_BANK,
      handChange: hand.minus(current.cashInHand),
      accountChange: account.minus(pool.cashInAccount),
      transitChange: amount.negated(),
      leftInBankChange: leftInBank.minus(pool.cashLeftInBank),
      hand,
      account,
      transit,
      leftInBank,
      drawerChange,
      remarks: input.remarks ?? STEP_LABEL[settlement.direction].FROM_BANK,
    });

    await this.repository.refreshFloatMirror(cspAgentId);

    return { approved: await this.mapOne(updated), next: null };
  }

  /** Cancels an open step: the money (and notes) go back where they came from. */
  async cancel(input: {
    agentId: string;
    settlementId: string;
    remarks?: string;
    machineCode: string;
  }) {
    const { cspAgentId, pool } = await this.lockPoolOf(input.agentId);
    const settlement = await this.lockOpenSettlement(input.agentId, input.settlementId);
    const cash = await this.repository.lockAgentCash([settlement.agentId]);
    const current = cash.get(settlement.agentId)!;
    const amount = D(settlement.amount);
    const transit = pool.cashInTransit.minus(amount);

    let hand = current.cashInHand;
    let account = pool.cashInAccount;
    let drawer = current.drawer;
    let drawerChange: Partial<Drawer> | null = null;
    let leftInBank = pool.cashLeftInBank;

    if (settlement.direction === CashSettlementDirection.ACCOUNT_TO_HAND) {
      account = account.plus(amount);
    } else if (settlement.direction === CashSettlementDirection.BANK_TO_HAND) {
      leftInBank = leftInBank.plus(amount);
    } else {
      // The notes taken out in step 1 go back into the drawer.
      const origin = settlement.parentId
        ? await this.db.cashSettlement.findUnique({ where: { id: settlement.parentId } })
        : settlement;
      const moved = moveDrawer(drawer, (origin?.drawer as Partial<Drawer>) ?? null, 1);

      hand = hand.plus(amount);
      drawer = moved.drawer;
      drawerChange = moved.change;

      await this.repository.updateAgentCash(settlement.agentId, hand, drawer);
    }

    await this.repository.updatePool(cspAgentId, {
      cashInAccount: account,
      cashInTransit: transit,
      cashLeftInBank: leftInBank,
    });

    const updated = await this.db.cashSettlement.update({
      where: { id: settlement.id },
      data: {
        status: CashSettlementStatus.CANCELLED,
        reviewedBy: input.machineCode,
        reviewedAt: new Date(),
        remarks: input.remarks ?? settlement.remarks,
      },
    });

    await this.writeLedger(updated, pool, {
      type: CashLedgerType.SETTLEMENT_CANCELLED,
      handChange: hand.minus(current.cashInHand),
      accountChange: account.minus(pool.cashInAccount),
      transitChange: amount.negated(),
      leftInBankChange: leftInBank.minus(pool.cashLeftInBank),
      hand,
      account,
      transit,
      leftInBank,
      drawerChange,
      remarks: input.remarks ?? `Cancelled: ${STEP_LABEL[settlement.direction][settlement.step]}`,
    });

    await this.repository.refreshFloatMirror(cspAgentId);

    return this.mapOne(updated);
  }

  /**
   * The KO's cash screen on the desktop: its own cash in hand and drawer,
   * the shared limit and cash in account, the day's history and open
   * settlements. `day` (IST) defaults to today; for a past day the balances
   * and drawer are those at the end of that day.
   */
  async getAgentToday(agentId: string, day?: Date) {
    // One query for the name and the pool's CSP (a CSP its own, a KO its parent's).
    const agent = await this.db.agent.findUnique({
      where: { agentId },
      select: { name: true, type: true, parentAgentId: true },
    });
    const cspAgentId =
      agent?.type === AgentType.CSP ? agentId : agent?.type === AgentType.KO ? agent.parentAgentId : null;
    const agentName = agent?.name ?? null;

    if (!cspAgentId) {
      throw new BadRequestError("This agent isn't part of a CSP.");
    }

    const now = new Date();
    const date = day ?? now;
    const isToday = istDateKey(date) === istDateKey(now);
    const today = { gte: startOfIstDay(date), lte: endOfIstDay(date) };

    const [pool, row, ledger, open, settledToday, lastRequest, dayClose, dues] = await Promise.all([
      this.repository.findPool(cspAgentId),
      this.db.agentCash.findUnique({ where: { agentId } }),
      this.db.cashLedger.findMany({
        where: { agentId, createdAt: today },
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { receipt: { select: { receiptId: true } } },
      }),
      isToday
        ? this.db.cashSettlement.findMany({
            where: { agentId, status: CashSettlementStatus.PENDING },
            orderBy: { createdAt: "asc" },
          })
        : Promise.resolve([]),
      this.db.cashSettlement.findMany({
        where: { agentId, createdAt: today, status: { not: CashSettlementStatus.PENDING } },
        orderBy: { createdAt: "desc" },
      }),
      this.db.cashRequest.findFirst({ where: { agentId }, orderBy: { createdAt: "desc" } }),
      this.db.cashDayClose.findUnique({
        where: { agentId_date: { agentId, date: istCalendarDate(date) } },
      }),
      new CashDeskService(this.db).dueTotals(agentId),
    ]);

    const [settledSteps, openSteps] = await Promise.all([this.mapAll(settledToday), this.mapAll(open)]);

    let drawer = row ? drawerOf(row) : emptyDrawer();
    let hand = row ? D(row.cashInHand) : ZERO;
    let balances = pool
      ? {
          cashLimit: D(pool.cashLimit),
          cashInAccount: D(pool.cashInAccount),
          cashInTransit: D(pool.cashInTransit),
          cashLeftInBank: D(pool.cashLeftInBank),
          cashOther: D(pool.cashOther),
          cashDueExtra: D(pool.cashDueExtra),
        }
      : null;

    if (!isToday) {
      const end = await this.balancesAt(cspAgentId, agentId, today.lte, drawer);

      hand = end.hand;
      drawer = end.drawer;
      balances = pool ? end.pool : null;
    }

    const totals = {
      deposits: ZERO,
      withdrawals: ZERO,
      moneyTransfers: ZERO,
      settlementsIn: ZERO,
      settlementsOut: ZERO,
      customIn: ZERO,
      customOut: ZERO,
      duesCollected: ZERO,
      duesGiven: ZERO,
    };

    for (const entry of ledger) {
      const change = D(entry.cashInHandChange);

      if (entry.type === CashLedgerType.RECEIPT && entry.amount) {
        if (entry.transactionCategory === TransactionCategory.CASH_DEPOSIT) totals.deposits = totals.deposits.plus(entry.amount);
        if (entry.transactionCategory === TransactionCategory.CASH_WITHDRAWAL) totals.withdrawals = totals.withdrawals.plus(entry.amount);
        if (entry.transactionCategory === TransactionCategory.MONEY_TRANSFER) totals.moneyTransfers = totals.moneyTransfers.plus(entry.amount);
      }

      if (entry.type === CashLedgerType.SETTLEMENT_FROM_BANK && change.isPositive()) {
        totals.settlementsIn = totals.settlementsIn.plus(change);
      }

      if (entry.type === CashLedgerType.SETTLEMENT_TO_BANK && change.isNegative()) {
        totals.settlementsOut = totals.settlementsOut.plus(change.negated());
      }

      if (entry.type === CashLedgerType.CUSTOM) {
        if (change.isPositive()) totals.customIn = totals.customIn.plus(change);
        if (change.isNegative()) totals.customOut = totals.customOut.plus(change.negated());
      }

      if (entry.type === CashLedgerType.DUE_SETTLED) {
        if (change.isPositive()) totals.duesCollected = totals.duesCollected.plus(change);
        if (change.isNegative()) totals.duesGiven = totals.duesGiven.plus(change.negated());
      }
    }

    const num = (value: Prisma.Decimal | null) => (value === null ? null : money(D(value)));

    return {
      setUp: !!pool,
      date: isToday ? now : today.lte,
      day: istDateKey(date),
      isToday,
      agent: { agentId, name: agentName, cspAgentId },
      cashLimit: balances ? money(balances.cashLimit) : null,
      cashInAccount: balances ? money(balances.cashInAccount) : null,
      cashInTransit: balances ? money(balances.cashInTransit) : null,
      cashLeftInBank: balances ? money(balances.cashLeftInBank) : null,
      cashOther: balances ? money(balances.cashOther) : null,
      cashDueExtra: balances ? money(balances.cashDueExtra) : null,
      cashInHand: money(hand),
      drawer,
      drawerTotal: drawerTotal(drawer),
      drawerMatchesCashInHand: drawerTotal(drawer) === money(hand),
      today: {
        totals: Object.fromEntries(
          Object.entries(totals).map(([key, value]) => [key, money(value)]),
        ),
        transactions: ledger.map((entry) => ({
          id: entry.id,
          type: entry.type,
          reason: entry.reason,
          transactionCategory: entry.transactionCategory,
          amount: num(entry.amount),
          cashInHandChange: money(D(entry.cashInHandChange)),
          cashInAccountChange: money(D(entry.cashInAccountChange)),
          cashOtherChange: money(D(entry.cashOtherChange)),
          cashDueExtraChange: money(D(entry.cashDueExtraChange)),
          balanceCashInHand: num(entry.balanceCashInHand),
          balanceCashInAccount: num(entry.balanceCashInAccount),
          drawerChange: entry.drawerChange,
          receiptId: entry.receipt?.receiptId ?? null,
          settlementId: entry.settlementId,
          remarks: entry.remarks,
          createdAt: entry.createdAt,
        })),
        settlements: settledSteps,
      },
      openSettlements: openSteps,
      dayClose: dayClose ? mapDayClose(dayClose) : null,
      // Open balance dues: { toCollect, toGive, openCount, bySide } (now).
      dues,
      lastRequest: lastRequest
        ? {
            id: lastRequest.id,
            status: lastRequest.status,
            requestedCashInHand: money(D(lastRequest.requestedCashInHand)),
            reviewRemarks: lastRequest.reviewRemarks,
            createdAt: lastRequest.createdAt,
          }
        : null,
    };
  }

  /**
   * Balances at `end`: the latest ledger balance of each kind up to then;
   * the drawer is today's minus every drawer change after `end`.
   */
  private async balancesAt(cspAgentId: string, agentId: string, end: Date, drawerNow: Drawer) {
    const last = (where: Prisma.CashLedgerWhereInput) =>
      this.db.cashLedger.findFirst({
        where: { createdAt: { lte: end }, ...where },
        orderBy: { createdAt: "desc" },
      });

    const [hand, account, limit, transit, left, other, dueExtra, later] = await Promise.all([
      last({ agentId, balanceCashInHand: { not: null } }),
      last({ cspAgentId, balanceCashInAccount: { not: null } }),
      last({ cspAgentId, balanceCashLimit: { not: null } }),
      last({ cspAgentId, balanceCashInTransit: { not: null } }),
      last({ cspAgentId, balanceCashLeftInBank: { not: null } }),
      last({ cspAgentId, balanceCashOther: { not: null } }),
      last({ cspAgentId, balanceCashDueExtra: { not: null } }),
      this.db.cashLedger.findMany({
        where: { agentId, createdAt: { gt: end }, drawerChange: { not: Prisma.DbNull } },
        select: { drawerChange: true },
      }),
    ]);

    const drawer = { ...drawerNow };

    for (const entry of later) {
      const change = entry.drawerChange as Partial<Drawer>;

      for (const key of DRAWER_KEYS) {
        drawer[key] = Math.max(0, drawer[key] - (change[key] ?? 0));
      }
    }

    const value = (entry: { [key: string]: unknown } | null, key: string) =>
      entry && entry[key] !== null ? D(entry[key] as Prisma.Decimal) : ZERO;

    return {
      hand: value(hand, "balanceCashInHand"),
      drawer,
      pool: {
        cashLimit: value(limit, "balanceCashLimit"),
        cashInAccount: value(account, "balanceCashInAccount"),
        cashInTransit: value(transit, "balanceCashInTransit"),
        cashLeftInBank: value(left, "balanceCashLeftInBank"),
        cashOther: value(other, "balanceCashOther"),
        cashDueExtra: value(dueExtra, "balanceCashDueExtra"),
      },
    };
  }

  /** CSP / BC / admin: the KOs' settlements (the CSP is informed, not asked). */
  async list(filter: {
    cspAgentId: string;
    agentIds?: string[];
    status?: CashSettlementStatus;
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }) {
    const where: Prisma.CashSettlementWhereInput = {
      cspAgentId: filter.cspAgentId,
      ...(filter.agentIds && { agentId: { in: filter.agentIds } }),
      ...(filter.status && { status: filter.status }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.db.cashSettlement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: { agent: { select: { name: true } } },
      }),
      this.db.cashSettlement.count({ where }),
    ]);

    return {
      items: (await this.mapAll(items)).map((item, index) => ({ ...item, agentName: items[index].agent.name })),
      pagination: {
        page: filter.page,
        limit: filter.limit,
        total,
        totalPages: Math.ceil(total / filter.limit),
      },
    };
  }

  // ---------------------------------------------------------------------------

  private async lockPoolOf(agentId: string) {
    const cspAgentId = await this.repository.findPoolCspId(agentId);

    if (!cspAgentId) {
      throw new BadRequestError("This agent isn't part of a CSP.");
    }

    const pool = await this.repository.lockPool(cspAgentId);

    if (!pool) {
      throw new BadRequestError(NOT_SET_UP_MESSAGE);
    }

    return { cspAgentId, pool };
  }

  /** The agent's own open step, locked (after the pool lock). */
  private async lockOpenSettlement(agentId: string, settlementId: string) {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "CashSettlement" WHERE "id" = ${settlementId} AND "agentId" = ${agentId}
      FOR UPDATE
    `;

    const settlement = rows.length
      ? await this.db.cashSettlement.findUnique({ where: { id: settlementId } })
      : null;

    if (!settlement) {
      throw new NotFoundError("Settlement not found.");
    }

    if (settlement.status !== CashSettlementStatus.PENDING) {
      throw new ConflictError(`This settlement step is already ${settlement.status.toLowerCase()}.`);
    }

    return settlement;
  }

  private writeLedger(
    settlement: Settlement,
    pool: LockedPool,
    change: {
      type: CashLedgerType;
      handChange: Prisma.Decimal;
      accountChange: Prisma.Decimal;
      transitChange: Prisma.Decimal;
      leftInBankChange: Prisma.Decimal;
      hand: Prisma.Decimal;
      account: Prisma.Decimal;
      transit: Prisma.Decimal;
      leftInBank: Prisma.Decimal;
      drawerChange: Partial<Drawer> | null;
      remarks: string;
    },
  ) {
    return this.repository.createLedger([
      {
        cspAgentId: settlement.cspAgentId,
        agentId: settlement.agentId,
        type: change.type,
        amount: settlement.amount,
        cashInHandChange: change.handChange,
        cashInAccountChange: change.accountChange,
        cashInTransitChange: change.transitChange,
        cashLeftInBankChange: change.leftInBankChange,
        balanceCashInHand: change.hand,
        balanceCashInAccount: change.account,
        balanceCashInTransit: change.transit,
        balanceCashLeftInBank: change.leftInBank,
        balanceCashLimit: pool.cashLimit,
        drawerChange: change.drawerChange ?? undefined,
        settlementId: settlement.id,
        actorType: CashActorType.MACHINE,
        actorId: settlement.reviewedBy ?? settlement.requestedBy,
        remarks: change.remarks,
      },
    ]);
  }

  /** The agent's open step for the heartbeat (what's waiting for the KO), or null. */
  async openStepSummary(agentId: string) {
    const open = await this.db.cashSettlement.findFirst({
      where: { agentId, status: CashSettlementStatus.PENDING },
    });

    if (!open) {
      return null;
    }

    const step = await this.mapOne(open);

    return {
      id: step.id,
      requestId: step.requestId,
      direction: step.direction,
      step: step.step,
      stepNumber: step.stepNumber,
      stepCount: step.stepCount,
      amount: step.amount,
      label: step.label,
      needsDenomination: step.needsDenomination,
    };
  }

  /** Maps steps with their step 1 loaded (one query for the whole list). */
  async mapAll(settlements: Settlement[]) {
    const parentIds = settlements.map((item) => item.parentId).filter((id): id is string => !!id);
    const parents = parentIds.length
      ? await this.db.cashSettlement.findMany({ where: { id: { in: parentIds } } })
      : [];
    const byId = new Map(parents.map((parent) => [parent.id, parent]));

    return settlements.map((item) => this.map(item, item.parentId ? byId.get(item.parentId) : undefined));
  }

  private async mapOne(settlement: Settlement) {
    return (await this.mapAll([settlement]))[0];
  }

  /**
   * One step. `requestId` ties both steps of a request together (step 1's
   * id); step 2 also has `previousStep`.
   */
  private map(settlement: Settlement, parent?: Settlement) {
    const single = settlement.direction === CashSettlementDirection.BANK_TO_HAND;
    const second = settlement.step === CashSettlementStep.FROM_BANK && !single;

    return {
      id: settlement.id,
      requestId: settlement.parentId ?? settlement.id,
      requestStartedAt: parent?.createdAt ?? settlement.createdAt,
      stepNumber: second ? 2 : 1,
      stepCount: single ? 1 : 2,
      previousStep: parent
        ? { id: parent.id, approvedAt: parent.reviewedAt, amount: money(D(parent.amount)) }
        : null,
      cspAgentId: settlement.cspAgentId,
      agentId: settlement.agentId,
      direction: settlement.direction,
      step: settlement.step,
      label: STEP_LABEL[settlement.direction][settlement.step],
      status: settlement.status,
      amount: money(D(settlement.amount)),
      settledAmount: settlement.settledAmount === null ? null : money(D(settlement.settledAmount)),
      // Step 2: what the bank kept (amount − settledAmount).
      leftInBank:
        settlement.settledAmount === null
          ? null
          : money(D(settlement.amount).minus(settlement.settledAmount)),
      drawer: settlement.drawer,
      // Bank → cash in hand steps are approved with the counted notes.
      needsDenomination:
        settlement.status === CashSettlementStatus.PENDING &&
        settlement.step === CashSettlementStep.FROM_BANK &&
        TO_DRAWER.includes(settlement.direction),
      parentId: settlement.parentId,
      remarks: settlement.remarks,
      requestedBy: settlement.requestedBy,
      reviewedBy: settlement.reviewedBy,
      reviewedAt: settlement.reviewedAt,
      createdAt: settlement.createdAt,
    };
  }
}

