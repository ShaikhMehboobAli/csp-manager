import { PrismaDb } from "../../core/database/prisma.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ConflictError } from "../../core/errors/ConflictError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { endOfIstDay, startOfIstDay } from "../../core/utils/ist";
import { Prisma } from "../../generated/prisma/client";
import {
  CashActorType,
  CashDueKind,
  CashDueSide,
  CashDueSource,
  CashDueStatus,
  CashFlowDirection,
  CashLabelDirection,
  CashLedgerType,
} from "../../generated/prisma/enums";

import {
  DRAWER_KEYS,
  DRAWER_VALUES,
  Drawer,
  DrawerKey,
  drawerOf,
  drawerTotal,
} from "./cash.constants";
import { D, NOT_SET_UP_MESSAGE, ZERO, money, rupees } from "./cash.helpers";
import CashRepository, { LockedAgentCash, LockedPool } from "./cash.repository";

type Due = Prisma.CashDueGetPayload<object>;

const CLOSED_DUES_DAYS = 14;

/** "₹100 notes" / "₹2 coins". */
function noteName(key: DrawerKey) {
  return `₹${DRAWER_VALUES[key]} ${key.startsWith("coins") ? "coins" : "notes"}`;
}

/** "1 × ₹500 + 2 × ₹100" (coins: "3 × ₹2 coin"). */
function notesText(notes: Drawer) {
  return DRAWER_KEYS.filter((key) => notes[key] > 0)
    .map((key) => `${notes[key]} × ₹${DRAWER_VALUES[key]}${key.startsWith("coins") ? " coin" : ""}`)
    .join(" + ");
}

/** Throws when the drawer can't give these notes. */
function requireInDrawer(drawer: Drawer, notes: Drawer, verb = "") {
  for (const key of DRAWER_KEYS) {
    if (notes[key] > drawer[key]) {
      throw new BadRequestError(`Not enough ${noteName(key)} in the drawer${verb}.`);
    }
  }
}

/** Adds (sign 1) or takes out (sign −1) exact note counts. */
function shiftDrawer(drawer: Drawer, notes: Drawer, sign: 1 | -1) {
  const next = { ...drawer };
  const change: Partial<Drawer> = {};

  for (const key of DRAWER_KEYS) {
    if (notes[key]) {
      next[key] = drawer[key] + sign * notes[key];
      change[key] = sign * notes[key];
    }
  }

  return { drawer: next, change: Object.keys(change).length > 0 ? change : null };
}

function mustEqual(notes: Drawer, amount: Prisma.Decimal, what: string) {
  const total = D(drawerTotal(notes));

  if (!total.equals(amount)) {
    throw new BadRequestError(
      `The notes' total (${rupees(total)}) must equal ${what} (${rupees(amount)}).`,
    );
  }
}

type Move = {
  hand: Prisma.Decimal;
  account: Prisma.Decimal;
  other: Prisma.Decimal;
  dueExtra: Prisma.Decimal;
};

const noMove = (): Move => ({ hand: ZERO, account: ZERO, other: ZERO, dueExtra: ZERO });

const addMoves = (a: Move, b: Move): Move => ({
  hand: a.hand.plus(b.hand),
  account: a.account.plus(b.account),
  other: a.other.plus(b.other),
  dueExtra: a.dueExtra.plus(b.dueExtra),
});

/**
 * What putting a due on a side moves (sign −1 = moving it back). To collect
 * adds the amount to the side, to give deducts it; cash in hand and cash in
 * account move against each other, other cash with "extra cash held by dues".
 */
function sideMove(kind: CashDueKind, side: CashDueSide, amount: Prisma.Decimal, sign: 1 | -1): Move {
  const value = (kind === CashDueKind.TO_COLLECT ? amount : amount.negated()).times(sign);

  if (side === CashDueSide.CASH_IN_HAND) {
    return { ...noMove(), hand: value, account: value.negated() };
  }

  if (side === CashDueSide.CASH_IN_ACCOUNT) {
    return { ...noMove(), account: value, hand: value.negated() };
  }

  return { ...noMove(), other: value, dueExtra: value };
}

/** "₹1,000" (Indian grouping; 2 decimals only when needed). */
function inr(value: Prisma.Decimal) {
  const number = Number(value.toFixed(2));

  return `₹${number.toLocaleString("en-IN", { minimumFractionDigits: value.isInteger() ? 0 : 2, maximumFractionDigits: 2 })}`;
}

const SIDE_NAMES: Record<CashDueSide, string> = {
  CASH_IN_HAND: "cash in hand",
  CASH_IN_ACCOUNT: "cash in account",
  OTHER_CASH: "extra cash",
};

const kindText = (kind: CashDueKind) => (kind === CashDueKind.TO_COLLECT ? "To collect" : "To give");

function sideText(due: Due) {
  if (!due.cashSide) {
    return null;
  }

  return `${due.kind === CashDueKind.TO_COLLECT ? "added to" : "deducted from"} ${SIDE_NAMES[due.cashSide]}`;
}

/** The move in words for the "added" message, e.g. " ₹1,000 added to cash in hand; cash in account −₹1,000." */
function moveText(due: Due, amount: Prisma.Decimal, holdsCash: boolean) {
  const collect = due.kind === CashDueKind.TO_COLLECT;

  if (holdsCash) {
    return ` ${inr(amount)} ${collect ? "taken out of" : "put back into"} cash in hand.`;
  }

  if (!due.cashSide) {
    return "";
  }

  const head = ` ${inr(amount)} ${collect ? "added to" : "deducted from"} ${SIDE_NAMES[due.cashSide]}`;

  if (due.cashSide === CashDueSide.OTHER_CASH) {
    return `${head}.`;
  }

  const counter = due.cashSide === CashDueSide.CASH_IN_HAND ? "cash in account" : "cash in hand";

  return `${head}; ${counter} ${collect ? "−" : "+"}${inr(amount)}.`;
}

/** Ledger balances after a change (pool values from `pool`). */
function balancesOf(cspAgentId: string, agentId: string, pool: LockedPool, hand: Prisma.Decimal) {
  return {
    cspAgentId,
    agentId,
    balanceCashInHand: hand,
    balanceCashInAccount: pool.cashInAccount,
    balanceCashLimit: pool.cashLimit,
    balanceCashInTransit: pool.cashInTransit,
    balanceCashLeftInBank: pool.cashLeftInBank,
    balanceCashOther: pool.cashOther,
    balanceCashDueExtra: pool.cashDueExtra,
  };
}

/**
 * The desktop's cash extras for the machine's agent: custom transactions
 * with the CSP's labels, balance due and cash exchange.
 *
 * Custom transactions and settled dues bring cash in from (or send it out
 * to) outside the SBI pool, so they move the pool's "other cash" with cash
 * in hand: account + all cash in hand + in transit + left in bank = limit +
 * other cash. Cash in account never changes here.
 */
export default class CashDeskService {
  private readonly repository: CashRepository;

  constructor(private readonly db: PrismaDb) {
    this.repository = new CashRepository(db);
  }

  // ---------------------------------------------------------------------------
  // Labels and custom transactions
  // ---------------------------------------------------------------------------

  /** The CSP's labels (active and inactive). */
  async listLabels(agentId: string) {
    const cspAgentId = await this.requireCspOf(agentId);

    const labels = await this.db.cashLabel.findMany({
      where: { cspAgentId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });

    return labels.map((label) => this.mapLabel(label));
  }

  async createCustomTransaction(input: {
    agentId: string;
    labelId: string;
    direction: CashFlowDirection;
    amount: number;
    paidNow: number;
    drawer?: Partial<Drawer>;
    note?: string;
    machineCode: string;
  }) {
    const context = await this.lockAgent(input.agentId);
    const { cspAgentId, current } = context;

    const label = await this.db.cashLabel.findFirst({
      where: { id: input.labelId, cspAgentId },
    });

    if (!label || !label.active) {
      throw new BadRequestError("That label isn't available any more. Ask your CSP.");
    }

    if (label.direction !== CashLabelDirection.BOTH && label.direction !== input.direction) {
      throw new BadRequestError(
        `That label can't be used for cash ${input.direction === CashFlowDirection.IN ? "in" : "out"}.`,
      );
    }

    const amount = D(input.amount);
    const paidNow = D(input.paidNow);

    if (paidNow.isNegative() || paidNow.greaterThan(amount)) {
      throw new BadRequestError("Paid now must be between ₹0 and the amount.");
    }

    const notes = drawerOf(input.drawer ?? {});

    mustEqual(notes, paidNow, "paid now");

    const cashIn = input.direction === CashFlowDirection.IN;

    if (!cashIn) {
      if (paidNow.greaterThan(current.cashInHand)) {
        throw new BadRequestError(
          `That's more than your cash in hand (${rupees(current.cashInHand)}).`,
        );
      }

      requireInDrawer(current.drawer, notes);
    }

    const handChange = cashIn ? paidNow : paidNow.negated();
    const paidNotes = drawerTotal(notes) > 0 ? notes : null;

    const transaction = await this.db.cashCustomTransaction.create({
      data: {
        cspAgentId,
        agentId: input.agentId,
        labelId: label.id,
        labelName: label.name,
        direction: input.direction,
        amount,
        paidNow,
        drawer: paidNotes ?? undefined,
        note: input.note,
        machineCode: input.machineCode,
      },
    });

    let cash = await this.applyMove(context, { ...noMove(), hand: handChange, other: handChange }, {
      notes: paidNotes,
      sign: cashIn ? 1 : -1,
      due: null,
      type: CashLedgerType.CUSTOM,
      amount,
      actorId: input.machineCode,
      remarks: input.note ? `${label.name} · ${input.note}` : label.name,
    });

    const rest = amount.minus(paidNow);
    let due: Due | null = null;

    if (rest.greaterThan(ZERO)) {
      due = await this.db.cashDue.create({
        data: {
          cspAgentId,
          agentId: input.agentId,
          kind: cashIn ? CashDueKind.TO_COLLECT : CashDueKind.TO_GIVE,
          source: CashDueSource.CUSTOM,
          amount: rest,
          originalAmount: rest,
          customTransactionId: transaction.id,
          label: label.name,
          note: input.note,
          createdBy: input.machineCode,
        },
      });

      cash = await this.applyMove(context, noMove(), {
        notes: null,
        sign: 1,
        due,
        type: CashLedgerType.DUE_CREATED,
        amount: rest,
        actorId: input.machineCode,
        remarks: `${kindText(due.kind)} · ${label.name}`,
      });
    }

    return {
      transaction: {
        id: transaction.id,
        labelId: label.id,
        label: label.name,
        direction: transaction.direction,
        amount: money(amount),
        paidNow: money(paidNow),
        cashDenomination: paidNotes,
        note: transaction.note,
        createdAt: transaction.createdAt,
      },
      due: due ? this.mapDue(due) : null,
      cash,
    };
  }

  // ---------------------------------------------------------------------------
  // Balance due
  // ---------------------------------------------------------------------------

  async listDues(agentIds: string[], status: "OPEN" | "CLOSED") {
    const open = await this.db.cashDue.findMany({
      where: { agentId: { in: agentIds }, status: CashDueStatus.OPEN },
      orderBy: { createdAt: "asc" },
      include: { agent: { select: { name: true } } },
    });

    const dues =
      status === "OPEN"
        ? open
        : await this.db.cashDue.findMany({
            where: {
              agentId: { in: agentIds },
              status: { in: [CashDueStatus.SETTLED, CashDueStatus.CANCELLED] },
              settledAt: { gte: new Date(Date.now() - CLOSED_DUES_DAYS * 86_400_000) },
            },
            orderBy: { settledAt: "desc" },
            include: { agent: { select: { name: true } } },
          });

    return {
      dues: dues.map((due) => ({ ...this.mapDue(due), agentName: due.agent.name })),
      totals: this.totalsOf(open),
    };
  }

  /**
   * One due with its history (from the ledger, oldest first). SETTLED is the
   * payment that cleared it; earlier payments are PART_SETTLED.
   */
  async getDue(dueId: string, agentIds: string[]) {
    const due = await this.db.cashDue.findFirst({
      where: { id: dueId, agentId: { in: agentIds } },
      include: { agent: { select: { name: true } } },
    });

    if (!due) {
      throw new NotFoundError("Due not found.");
    }

    const entries = await this.db.cashLedger.findMany({
      where: { dueId: due.id },
      orderBy: { createdAt: "asc" },
    });

    let left = D(due.originalAmount);

    const events = entries.map((entry) => {
      const amount = D(entry.amount ?? 0);
      let type: "CREATED" | "PART_SETTLED" | "SETTLED" | "CANCELLED" = "CREATED";

      if (entry.type === CashLedgerType.DUE_SETTLED) {
        left = left.minus(amount);
        type = left.greaterThan(ZERO) ? "PART_SETTLED" : "SETTLED";
      } else if (entry.type === CashLedgerType.DUE_CANCELLED) {
        type = "CANCELLED";
      }

      return {
        type,
        amount: money(amount),
        stillDue: type === "CANCELLED" ? 0 : money(left),
        cashSide: due.cashSide,
        cashInHandChange: money(D(entry.cashInHandChange)),
        cashInAccountChange: money(D(entry.cashInAccountChange)),
        cashOtherChange: money(D(entry.cashOtherChange)),
        drawerChange: entry.drawerChange,
        machineCode: entry.actorId,
        remarks: entry.remarks,
        createdAt: entry.createdAt,
      };
    });

    return { ...this.mapDue(due), agentName: due.agent.name, events };
  }

  /** Open dues of one agent, for the heartbeat and the cash screen. */
  async dueTotals(agentId: string) {
    const open = await this.db.cashDue.findMany({
      where: { agentId, status: CashDueStatus.OPEN },
      select: { kind: true, amount: true, cashSide: true },
    });

    const totals = this.totalsOf(open);
    const bySide = Object.fromEntries(
      Object.values(CashDueSide).map((side) => {
        const own = this.totalsOf(open.filter((due) => due.cashSide === side));

        return [side, { toCollect: own.toCollect, toGive: own.toGive }];
      }),
    );

    return {
      toCollect: totals.toCollect,
      toGive: totals.toGive,
      openCount: open.length,
      bySide,
    };
  }

  /**
   * A due made by hand or for a receipt.
   *
   * - With `cashSide` (no receipt): the amount is put on that side now.
   *   Cash in hand and cash in account move against each other; OTHER_CASH
   *   moves other cash and "extra cash held by dues" together. Settling or
   *   cancelling moves it back.
   * - With `receiptId` for a cash receipt the server applied: the unpaid
   *   amount and its notes come out of (TO_COLLECT) or go back into
   *   (TO_GIVE) cash in hand and the drawer; settling reverses that.
   * - Neither: nothing moves until it's settled.
   */
  async createDue(input: {
    agentId: string;
    kind: CashDueKind;
    amount: number;
    note: string;
    receiptId?: string | null;
    cashSide?: CashDueSide;
    drawer?: Partial<Drawer>;
    machineCode: string;
  }) {
    const context = await this.lockAgent(input.agentId);
    const amount = D(input.amount);
    const collect = input.kind === CashDueKind.TO_COLLECT;

    let source: CashDueSource = CashDueSource.MANUAL;
    let receipt: { id: string; receiptId: string; transactionType: string } | null = null;
    let holdsCash = false;
    let move = noMove();
    let notes: Drawer | null = null;

    if (input.receiptId) {
      if (input.cashSide) {
        throw new BadRequestError("A due for a receipt has no cash side: leave cashSide out.");
      }

      const found = await this.db.receipt.findFirst({
        where: { agentId: input.agentId, receiptId: input.receiptId },
        select: { id: true, receiptId: true, transactionType: true, amount: true },
      });

      if (!found) {
        throw new NotFoundError("Receipt not found for this agent.");
      }

      if (found.amount && amount.greaterThan(found.amount)) {
        throw new BadRequestError(
          `The due can't be more than the receipt amount (${rupees(D(found.amount))}).`,
        );
      }

      const existing = await this.db.cashDue.findFirst({
        where: { receiptRecordId: found.id, status: CashDueStatus.OPEN },
        select: { id: true },
      });

      if (existing) {
        throw new ConflictError("This receipt already has an open due.");
      }

      const applied = await this.db.cashLedger.findFirst({
        where: { receiptRecordId: found.id, type: CashLedgerType.RECEIPT },
        select: { id: true },
      });

      source = CashDueSource.RECEIPT;
      receipt = found;
      holdsCash = !!applied;
    }

    if (holdsCash) {
      if (!input.drawer) {
        throw new BadRequestError(
          "Cash denomination is required for a receipt due: the notes not received (to collect) or not paid out (to give).",
        );
      }

      notes = drawerOf(input.drawer);
      mustEqual(notes, amount, "the amount");

      if (collect) {
        requireInDrawer(context.current.drawer, notes);
      }

      const change = collect ? amount.negated() : amount;

      move = { ...noMove(), hand: change, other: change };
    } else if (input.cashSide) {
      move = sideMove(input.kind, input.cashSide, amount, 1);
    }

    const due = await this.db.cashDue.create({
      data: {
        cspAgentId: context.cspAgentId,
        agentId: input.agentId,
        kind: input.kind,
        source,
        amount,
        originalAmount: amount,
        receiptRecordId: receipt?.id,
        receiptId: receipt?.receiptId,
        label: receipt?.transactionType ?? null,
        note: input.note,
        holdsCash,
        cashSide: input.cashSide ?? null,
        drawer: notes ?? undefined,
        createdBy: input.machineCode,
      },
    });

    const cash = await this.applyMove(context, move, {
      notes,
      sign: collect ? -1 : 1,
      due,
      type: CashLedgerType.DUE_CREATED,
      amount,
      actorId: input.machineCode,
      remarks: [kindText(due.kind), sideText(due), due.label ?? input.note].filter(Boolean).join(" · "),
    });

    return { due: this.mapDue(due), cash, message: `Balance due added.${moveText(due, amount, holdsCash)}` };
  }

  async settleDue(input: {
    agentId: string;
    dueId: string;
    amount: number;
    drawer: Partial<Drawer>;
    machineCode: string;
  }) {
    const context = await this.lockAgent(input.agentId);
    const due = await this.lockOpenDue(input.agentId, input.dueId);
    const amount = D(input.amount);

    if (!amount.greaterThan(ZERO) || amount.greaterThan(due.amount)) {
      throw new BadRequestError(
        `The amount must be more than ₹0 and at most ${rupees(D(due.amount))}.`,
      );
    }

    const notes = drawerOf(input.drawer);

    mustEqual(notes, amount, "the amount");

    const collect = due.kind === CashDueKind.TO_COLLECT;

    if (!collect) {
      requireInDrawer(context.current.drawer, notes);
    }

    // The notes taken / given, from outside SBI; plus the side put back.
    const change = collect ? amount : amount.negated();
    const move = addMoves(
      { ...noMove(), hand: change, other: change },
      due.cashSide ? sideMove(due.kind, due.cashSide, amount, -1) : noMove(),
    );
    const rest = D(due.amount).minus(amount);

    const updated = await this.db.cashDue.update({
      where: { id: due.id },
      data: rest.isZero()
        ? { amount: rest, status: CashDueStatus.SETTLED, settledAt: new Date() }
        : { amount: rest },
    });

    const cash = await this.applyMove(context, move, {
      notes,
      sign: collect ? 1 : -1,
      due: updated,
      type: CashLedgerType.DUE_SETTLED,
      amount,
      actorId: input.machineCode,
      remarks: `${collect ? "Collected" : "Given"}: ${due.label ?? due.note ?? "balance due"}`,
    });

    return { due: this.mapDue(updated), cash, rest: money(rest) };
  }

  /**
   * For a due added by mistake: what creating it moved goes back (for the
   * part still due). A receipt due that's still whole gets its notes back.
   */
  async cancelDue(input: { agentId: string; dueId: string; machineCode: string }) {
    const context = await this.lockAgent(input.agentId);
    const due = await this.lockOpenDue(input.agentId, input.dueId);
    const rest = D(due.amount);
    const collect = due.kind === CashDueKind.TO_COLLECT;

    let move = noMove();
    let notes: Drawer | null = null;

    if (due.holdsCash) {
      const change = collect ? rest : rest.negated();

      move = { ...noMove(), hand: change, other: change };

      if (due.drawer && rest.equals(due.originalAmount)) {
        notes = drawerOf(due.drawer as Partial<Drawer>);

        if (!collect) {
          requireInDrawer(context.current.drawer, notes);
        }
      }
    } else if (due.cashSide) {
      move = sideMove(due.kind, due.cashSide, rest, -1);
    }

    const updated = await this.db.cashDue.update({
      where: { id: due.id },
      data: { status: CashDueStatus.CANCELLED, settledAt: new Date() },
    });

    const cash = await this.applyMove(
      context,
      move,
      {
        notes,
        sign: collect ? 1 : -1,
        due: updated,
        type: CashLedgerType.DUE_CANCELLED,
        amount: rest,
        actorId: input.machineCode,
        remarks: `Cancelled due: ${due.label ?? due.note ?? "balance due"}`,
      },
      " to cancel it",
    );

    return { due: this.mapDue(updated), cash };
  }

  // ---------------------------------------------------------------------------
  // Cash exchange (giving change): drawer only
  // ---------------------------------------------------------------------------

  async createExchange(input: {
    agentId: string;
    taken: Partial<Drawer>;
    given: Partial<Drawer>;
    note?: string;
    machineCode: string;
  }) {
    const { cspAgentId, pool, current } = await this.lockAgent(input.agentId);
    const taken = drawerOf(input.taken);
    const given = drawerOf(input.given);
    const takenTotal = D(drawerTotal(taken));
    const givenTotal = D(drawerTotal(given));

    if (!takenTotal.greaterThan(ZERO)) {
      throw new BadRequestError("Enter the notes taken from the customer.");
    }

    if (!takenTotal.equals(givenTotal)) {
      throw new BadRequestError(
        `Both sides must be equal: taken ${rupees(takenTotal)}, given ${rupees(givenTotal)}.`,
      );
    }

    // The notes taken can be given back in the same exchange.
    const available = shiftDrawer(current.drawer, taken, 1).drawer;

    requireInDrawer(available, given, " to give");

    const drawer = shiftDrawer(available, given, -1).drawer;
    const change: Partial<Drawer> = {};

    for (const key of DRAWER_KEYS) {
      if (drawer[key] !== current.drawer[key]) {
        change[key] = drawer[key] - current.drawer[key];
      }
    }

    await this.repository.updateAgentCash(input.agentId, current.cashInHand, drawer);

    const exchange = await this.db.cashExchange.create({
      data: {
        cspAgentId,
        agentId: input.agentId,
        taken,
        given,
        amount: takenTotal,
        note: input.note,
        machineCode: input.machineCode,
      },
    });

    await this.repository.createLedger([
      {
        ...balancesOf(cspAgentId, input.agentId, pool, current.cashInHand),
        type: CashLedgerType.EXCHANGE,
        amount: takenTotal,
        drawerChange: Object.keys(change).length > 0 ? change : undefined,
        actorType: CashActorType.MACHINE,
        actorId: input.machineCode,
        // e.g. "1 × ₹500 → 5 × ₹100 · Change for a customer"
        remarks: [`${notesText(taken)} → ${notesText(given)}`, input.note].filter(Boolean).join(" · "),
      },
    ]);

    return this.mapExchange(exchange);
  }

  async listExchanges(agentId: string, day: Date) {
    const exchanges = await this.db.cashExchange.findMany({
      where: { agentId, createdAt: { gte: startOfIstDay(day), lte: endOfIstDay(day) } },
      orderBy: { createdAt: "desc" },
    });

    return exchanges.map((exchange) => this.mapExchange(exchange));
  }

  // ---------------------------------------------------------------------------

  private async requireCspOf(agentId: string) {
    const cspAgentId = await this.repository.findPoolCspId(agentId);

    if (!cspAgentId) {
      throw new BadRequestError("This agent isn't part of a CSP.");
    }

    return cspAgentId;
  }

  /** Pool lock first, then the agent's row (the module's lock order). */
  private async lockAgent(agentId: string): Promise<{
    cspAgentId: string;
    pool: LockedPool;
    current: LockedAgentCash;
  }> {
    const cspAgentId = await this.requireCspOf(agentId);
    const pool = await this.repository.lockPool(cspAgentId);

    if (!pool) {
      throw new BadRequestError(NOT_SET_UP_MESSAGE);
    }

    const cash = await this.repository.lockAgentCash([agentId]);

    return { cspAgentId, pool, current: cash.get(agentId)! };
  }

  private async lockOpenDue(agentId: string, dueId: string) {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "CashDue" WHERE "id" = ${dueId} AND "agentId" = ${agentId}
      FOR UPDATE
    `;

    const due = rows.length ? await this.db.cashDue.findUnique({ where: { id: dueId } }) : null;

    if (!due) {
      throw new NotFoundError("Due not found.");
    }

    if (due.status !== CashDueStatus.OPEN) {
      throw new BadRequestError("This due is already settled or cancelled.");
    }

    return due;
  }

  /**
   * Applies a move to the agent's cash in hand and drawer (`notes` × `sign`)
   * and the pool (cash in account, other cash, extra cash held by dues),
   * with one ledger row. Nothing may go below 0: the side that goes down
   * must have the amount. Updates `context` so a second move sees it.
   */
  private async applyMove(
    context: { cspAgentId: string; pool: LockedPool; current: LockedAgentCash },
    move: Move,
    ledger: {
      notes: Drawer | null;
      sign: 1 | -1;
      due: Due | null;
      type: CashLedgerType;
      amount: Prisma.Decimal;
      actorId: string;
      remarks: string;
    },
    verb = "",
  ) {
    const { cspAgentId, pool, current } = context;
    const hand = current.cashInHand.plus(move.hand);
    const account = pool.cashInAccount.plus(move.account);

    if (hand.isNegative()) {
      throw new BadRequestError(
        verb
          ? `Not enough cash in hand${verb} (${rupees(current.cashInHand)}).`
          : `That's more than your cash in hand (${rupees(current.cashInHand)}).`,
      );
    }

    if (account.isNegative()) {
      throw new BadRequestError(
        verb
          ? `Not enough cash in account${verb} (${rupees(pool.cashInAccount)}).`
          : `That's more than the cash in account (${rupees(pool.cashInAccount)}).`,
      );
    }

    const moved = ledger.notes ? shiftDrawer(current.drawer, ledger.notes, ledger.sign) : { drawer: current.drawer, change: null };
    const next: LockedPool = {
      ...pool,
      cashInAccount: account,
      cashOther: pool.cashOther.plus(move.other),
      cashDueExtra: pool.cashDueExtra.plus(move.dueExtra),
    };

    if (!move.account.isZero() || !move.other.isZero() || !move.dueExtra.isZero()) {
      await this.repository.updatePool(cspAgentId, {
        cashInAccount: next.cashInAccount,
        cashOther: next.cashOther,
        cashDueExtra: next.cashDueExtra,
      });
    }

    if (!move.hand.isZero() || moved.change) {
      await this.repository.updateAgentCash(current.agentId, hand, moved.drawer);
    }

    await this.repository.createLedger([
      {
        ...balancesOf(cspAgentId, current.agentId, next, hand),
        type: ledger.type,
        amount: ledger.amount,
        cashInHandChange: move.hand,
        cashInAccountChange: move.account,
        cashOtherChange: move.other,
        cashDueExtraChange: move.dueExtra,
        drawerChange: moved.change ?? undefined,
        receiptRecordId: ledger.due?.receiptRecordId,
        dueId: ledger.due?.id,
        actorType: CashActorType.MACHINE,
        actorId: ledger.actorId,
        remarks: ledger.remarks,
      },
    ]);

    if (!move.hand.isZero() || !move.account.isZero() || !move.other.isZero()) {
      await this.repository.refreshFloatMirror(cspAgentId);
    }

    context.pool = next;
    context.current = { ...current, cashInHand: hand, drawer: moved.drawer };

    return {
      cashInHand: money(hand),
      cashInAccount: money(next.cashInAccount),
      cashOther: money(next.cashOther),
      cashDueExtra: money(next.cashDueExtra),
      drawer: moved.drawer,
      drawerTotal: drawerTotal(moved.drawer),
    };
  }

  private totalsOf(open: { kind: CashDueKind; amount: Prisma.Decimal }[]) {
    let toCollect = ZERO;
    let toGive = ZERO;
    let collectCount = 0;
    let giveCount = 0;

    for (const due of open) {
      if (due.kind === CashDueKind.TO_COLLECT) {
        toCollect = toCollect.plus(due.amount);
        collectCount++;
      } else {
        toGive = toGive.plus(due.amount);
        giveCount++;
      }
    }

    return { toCollect: money(toCollect), collectCount, toGive: money(toGive), giveCount };
  }

  mapLabel(label: Prisma.CashLabelGetPayload<object>) {
    return {
      id: label.id,
      name: label.name,
      direction: label.direction,
      active: label.active,
      createdAt: label.createdAt,
      updatedAt: label.updatedAt,
    };
  }

  mapDue(due: Due) {
    return {
      id: due.id,
      agentId: due.agentId,
      kind: due.kind,
      amount: money(D(due.amount)),
      originalAmount: money(D(due.originalAmount)),
      source: due.source,
      receiptId: due.receiptId,
      customTransactionId: due.customTransactionId,
      label: due.label,
      note: due.note,
      status: due.status,
      // Where the amount was put when it was added (null = nothing moved).
      cashSide: due.cashSide,
      createdAt: due.createdAt,
      settledAt: due.settledAt,
    };
  }

  private mapExchange(exchange: Prisma.CashExchangeGetPayload<object>) {
    return {
      id: exchange.id,
      taken: exchange.taken,
      given: exchange.given,
      amount: money(D(exchange.amount)),
      note: exchange.note,
      createdAt: exchange.createdAt,
    };
  }
}
