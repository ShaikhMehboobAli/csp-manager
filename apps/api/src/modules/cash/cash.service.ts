import { PrismaDb } from "../../core/database/prisma.types";
import { notifyCspOfKo } from "./cash-notify.helper";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ConflictError } from "../../core/errors/ConflictError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { Prisma } from "../../generated/prisma/client";
import {
  CashActorType,
  CashLedgerType,
  CashRequestStatus,
  TransactionCategory,
} from "../../generated/prisma/enums";
import { CashEffect } from "../float/config/ledger-rule.config";
import { getLedgerRule } from "../float/config/ledger-rule.helper";

import {
  DRAWER_KEYS,
  Drawer,
  NOT_APPLIED_REASONS,
  NotAppliedReason,
  drawerOf,
  drawerTotal,
  emptyDrawer,
} from "./cash.constants";
import CashDeskService from "./cash-desk.service";
import CashSettlementService from "./cash-settlement.service";
import { CashTaskService } from "./cash-task.service";
import NotificationService from "../notifications/notification.service";
import { NotificationKind, NotificationType } from "../../generated/prisma/enums";
import CashRepository, { LockedAgentCash, LockedPool } from "./cash.repository";
import CashReceiptCountService from "./cash-receipt-count.service";
import {
  D,
  NOT_SET_UP_MESSAGE,
  ZERO,
  drawerChangeBetween,
  money,
  moveDrawer,
  rupees,
} from "./cash.helpers";

export interface CashActor {
  type: CashActorType;
  id: string | null;
}

export interface CashReceipt {
  receiptRecordId: string;
  transactionCategory: TransactionCategory;
  amount: number | Prisma.Decimal | null | undefined;
  cashDenomination?: Partial<Drawer> | null;
}

export type ReceiptCashResult =
  | { status: "APPLIED"; denomination?: "PENDING" }
  | { status: "NOT_APPLIED"; reason: NotAppliedReason };

/**
 * Cash management for a CSP and its KOs. They share one cash in account (the
 * pool); each has its own cash in hand and drawer. The cash limit is not set
 * by anyone and never checked: it is worked out as
 *   all cash in hand + cash in account + in bank (open settlements)
 *   + left in bank + extra cash held by dues − other cash,
 * so it moves whenever the CSP (or a KO at activation, with "other") brings
 * cash in or takes it out. Every change is written to CashLedger. Write
 * methods must run inside a transaction: they lock the pool first, so
 * changes to one pool apply one after the other.
 */
export default class CashService {
  private readonly repository: CashRepository;

  constructor(private readonly db: PrismaDb) {
    this.repository = new CashRepository(db);
  }

  // ---------------------------------------------------------------------------
  // Opening
  // ---------------------------------------------------------------------------

  /**
   * Opens the CSP's pool (signup, or a BC creating the CSP) with the CSP's
   * cash in hand and cash in account; the cash limit is their sum. At first
   * the CSP holds all the cash in hand; it hands some to each KO it adds. An
   * existing pool with nothing recorded but its opening (e.g. signup sent
   * again) is reset; once anything else is recorded it's KEPT as it is.
   */
  async openPool(input: {
    cspAgentId: string;
    cashInAccount: number;
    cashInHand: number;
    actor: CashActor;
  }): Promise<"CREATED" | "UPDATED" | "KEPT"> {
    const account = D(input.cashInAccount);
    const hand = D(input.cashInHand);
    const limit = hand.plus(account);

    const pool = await this.repository.lockPool(input.cspAgentId);

    if (pool) {
      const used = await this.repository.countLedger(input.cspAgentId, {
        type: { not: CashLedgerType.OPENING },
      });

      if (used > 0) {
        return "KEPT";
      }

      await this.repository.updatePool(input.cspAgentId, {
        cashLimit: limit,
        cashInAccount: account,
      });

      await this.repository.deleteOpeningLedger(input.cspAgentId);
    } else {
      await this.repository.createPool(input.cspAgentId, limit, account);
    }

    const cash = await this.repository.lockAgentCash([input.cspAgentId]);
    const current = cash.get(input.cspAgentId)!;

    await this.repository.updateAgentCash(
      input.cspAgentId,
      hand,
      current.drawer,
    );

    await this.repository.createLedger([
      {
        cspAgentId: input.cspAgentId,
        agentId: input.cspAgentId,
        type: CashLedgerType.OPENING,
        cashInHandChange: hand,
        cashInAccountChange: account,
        cashLimitChange: limit,
        balanceCashInHand: hand,
        balanceCashInAccount: account,
        balanceCashLimit: limit,
        actorType: input.actor.type,
        actorId: input.actor.id,
        remarks: "Opening balances",
      },
    ]);

    await this.repository.refreshFloatMirror(input.cspAgentId);

    return pool ? "UPDATED" : "CREATED";
  }

  /**
   * A KO joins its CSP's pool with the cash in hand the CSP gives it.
   *
   * - Without `adjustments`: it comes out of the CSP's own cash in hand, as
   *   far as that goes; the rest is new cash (the cash limit goes up).
   * - With `adjustments`: the CSP set the new cash in hand of existing agents
   *   (itself and/or KOs) in the form; those are applied as given and the
   *   CSP's cash in hand isn't touched otherwise. The limit moves by the net.
   *
   * Nothing is compared with the limit. Every existing agent whose cash in
   * hand changed gets a mandatory "Adjust" request on the desktop (when the
   * plan has cash management) to count the notes given / taken.
   * NOT_SET_UP when the CSP has no pool yet.
   */
  async addAgent(input: {
    cspAgentId: string;
    agentId: string;
    cashInHand: number;
    adjustments?: { agentId: string; cashInHand: number }[];
    drawerRequests: boolean;
    actor: CashActor;
  }): Promise<
    | { status: "NOT_SET_UP" }
    | {
        status: "ADDED";
        cashLimit: number;
        cashLimitChange: number;
        cashInAccount: number;
        agents: { agentId: string; cashInHandBefore: number; cashInHand: number }[];
      }
  > {
    const pool = await this.repository.lockPool(input.cspAgentId);

    if (!pool) {
      return { status: "NOT_SET_UP" };
    }

    const adjustments = input.adjustments ?? [];
    const adjustedIds = adjustments.map((item) => item.agentId);

    if (new Set(adjustedIds).size !== adjustedIds.length) {
      throw new BadRequestError("Each agent can appear only once.");
    }

    if (adjustedIds.includes(input.agentId)) {
      throw new BadRequestError("The new KO's cash in hand goes in cashInHand, not in adjustments.");
    }

    await this.requireUnitAgents(input.cspAgentId, adjustedIds);

    const cash = await this.repository.lockAgentCash([
      input.agentId,
      input.cspAgentId,
      ...adjustedIds,
    ]);

    const koBefore = cash.get(input.agentId)!;
    const koHand = D(input.cashInHand);

    if (koHand.isNegative()) {
      throw new BadRequestError("Cash in hand can't be below ₹0.00.");
    }
    const after = new Map<string, Prisma.Decimal>();

    if (input.adjustments) {
      for (const item of adjustments) {
        if (item.cashInHand < 0) {
          throw new BadRequestError("Cash in hand can't be below ₹0.00.");
        }

        after.set(item.agentId, D(item.cashInHand));
      }
    } else {
      const csp = cash.get(input.cspAgentId)!;
      const needed = koHand.minus(koBefore.cashInHand);
      const taken = Prisma.Decimal.max(ZERO, Prisma.Decimal.min(needed, csp.cashInHand));

      if (!taken.isZero()) {
        after.set(input.cspAgentId, csp.cashInHand.minus(taken));
      }
    }

    let limitChange = koHand.minus(koBefore.cashInHand);

    const changed: { agentId: string; before: Prisma.Decimal; after: Prisma.Decimal }[] = [];

    for (const [agentId, hand] of after) {
      const before = cash.get(agentId)!.cashInHand;

      if (!hand.equals(before)) {
        changed.push({ agentId, before, after: hand });
        limitChange = limitChange.plus(hand.minus(before));
      }
    }

    const limit = pool.cashLimit.plus(limitChange);
    const rows: Prisma.CashLedgerUncheckedCreateInput[] = [];

    for (const item of changed) {
      const current = cash.get(item.agentId)!;

      await this.repository.updateAgentCash(item.agentId, item.after, current.drawer);

      rows.push({
        cspAgentId: input.cspAgentId,
        agentId: item.agentId,
        type: CashLedgerType.ADJUSTMENT,
        reason: "KO_CREATION",
        cashInHandChange: item.after.minus(item.before),
        balanceCashInHand: item.after,
        balanceCashInAccount: pool.cashInAccount,
        actorType: input.actor.type,
        actorId: input.actor.id,
        remarks: `Cash in hand moved for new KO ${input.agentId}`,
      });

      if (input.drawerRequests) {
        await this.createDrawerAdjustment({
          cspAgentId: input.cspAgentId,
          agentId: item.agentId,
          source: "KO_CREATION",
          before: item.before,
          after: item.after,
          drawer: current.drawer,
          remarks: `Cash in hand changed while adding KO ${input.agentId}`,
          requestedBy: input.actor.id ?? "SYSTEM",
        });
      }
    }

    await this.repository.updateAgentCash(input.agentId, koHand, koBefore.drawer);

    rows.push({
      cspAgentId: input.cspAgentId,
      agentId: input.agentId,
      type: CashLedgerType.AGENT_ADDED,
      cashInHandChange: koHand.minus(koBefore.cashInHand),
      cashLimitChange: limitChange,
      balanceCashInHand: koHand,
      balanceCashInAccount: pool.cashInAccount,
      balanceCashLimit: limit,
      actorType: input.actor.type,
      actorId: input.actor.id,
      remarks: limitChange.isZero()
        ? "KO added with opening cash in hand"
        : `KO added with opening cash in hand; cash limit ${limitChange.isNegative() ? "down" : "up"} ${rupees(limitChange.abs())}`,
    });

    if (!limitChange.isZero()) {
      await this.repository.updatePool(input.cspAgentId, { cashLimit: limit });
    }

    await this.repository.createLedger(rows);
    await this.repository.refreshFloatMirror(input.cspAgentId);

    return {
      status: "ADDED",
      cashLimit: money(limit),
      cashLimitChange: money(limitChange),
      cashInAccount: money(pool.cashInAccount),
      agents: [
        ...changed.map((item) => ({
          agentId: item.agentId,
          cashInHandBefore: money(item.before),
          cashInHand: money(item.after),
        })),
        { agentId: input.agentId, cashInHandBefore: money(koBefore.cashInHand), cashInHand: money(koHand) },
      ],
    };
  }

  /**
   * Machine activation: the agent counts its cash in hand and drawer, which
   * replace the stored ones (the desktop pre-fills the cash in hand the CSP
   * gave it). When the count differs, the agent says where the difference
   * came from / went to (`differenceSource`):
   * - CASH_IN_ACCOUNT: cash in account changes by the difference (more cash
   *   in hand = less in account, and the other way round); limit unchanged.
   * - OTHER: cash brought in / taken out by the CSP; only the cash in hand
   *   changes, so the cash limit moves. The CSP is notified.
   * Both are audited (CashLedger ACTIVATION). The caller has checked that the
   * drawer total equals the cash in hand. Before the CSP sets up cash
   * management the count is SAVED as the agent's cash in hand. NOT_SET_UP
   * when the agent isn't part of a CSP (nothing is kept).
   */
  async setCashAtActivation(input: {
    agentId: string;
    cashInHand: number;
    drawer: Partial<Drawer>;
    differenceSource?: "CASH_IN_ACCOUNT" | "OTHER";
    machineCode: string;
  }) {
    const cspAgentId = await this.repository.findPoolCspId(input.agentId);
    const pool = cspAgentId ? await this.repository.lockPool(cspAgentId) : null;

    if (!cspAgentId) {
      return { status: "NOT_SET_UP" as const };
    }

    const cash = await this.repository.lockAgentCash([input.agentId]);
    const current = cash.get(input.agentId)!;
    const hand = D(input.cashInHand);
    const drawer = drawerOf(input.drawer);

    if (!pool) {
      await this.repository.updateAgentCash(input.agentId, hand, drawer);

      await this.repository.createLedger([
        {
          cspAgentId,
          agentId: input.agentId,
          type: CashLedgerType.ACTIVATION,
          cashInHandChange: hand.minus(current.cashInHand),
          balanceCashInHand: hand,
          drawerChange: drawerChangeBetween(current.drawer, drawer) ?? undefined,
          actorType: CashActorType.MACHINE,
          actorId: input.machineCode,
          remarks: "Cash in hand counted at machine activation (applies when cash management is set up)",
        },
      ]);

      return { status: "SAVED" as const, cashInHand: money(hand) };
    }

    const change = hand.minus(current.cashInHand);

    if (!change.isZero() && !input.differenceSource) {
      throw new BadRequestError(
        `The cash in hand you counted (${rupees(hand)}) differs from what the CSP gave you (${rupees(current.cashInHand)}) by ${rupees(change.abs())}. Say where the difference ${change.isNegative() ? "went" : "came from"}: differenceSource CASH_IN_ACCOUNT or OTHER.`,
        "CASH_DIFFERENCE_SOURCE_REQUIRED",
      );
    }

    const fromAccount = input.differenceSource === "CASH_IN_ACCOUNT";
    const account = fromAccount ? pool.cashInAccount.minus(change) : pool.cashInAccount;
    const limitChange = change.isZero() || fromAccount ? ZERO : change;
    const limit = pool.cashLimit.plus(limitChange);

    if (account.isNegative()) {
      throw new BadRequestError(
        `Not enough cash in account for this cash in hand: ${rupees(pool.cashInAccount)} available, ${rupees(change)} needed. Choose OTHER if the CSP brought this cash in.`,
      );
    }

    await this.repository.updatePool(cspAgentId, { cashInAccount: account, cashLimit: limit });
    await this.repository.updateAgentCash(input.agentId, hand, drawer);

    const reason = change.isZero()
      ? null
      : fromAccount
        ? change.isNegative()
          ? "DIFFERENCE_TO_CASH_IN_ACCOUNT"
          : "DIFFERENCE_FROM_CASH_IN_ACCOUNT"
        : change.isNegative()
          ? "OTHER_DECREASED_BY_CSP"
          : "OTHER_INCREASED_BY_CSP";

    await this.repository.createLedger([
      {
        cspAgentId,
        agentId: input.agentId,
        type: CashLedgerType.ACTIVATION,
        reason,
        amount: change.isZero() ? undefined : change.abs(),
        cashInHandChange: change,
        cashInAccountChange: account.minus(pool.cashInAccount),
        cashLimitChange: limitChange,
        balanceCashInHand: hand,
        balanceCashInAccount: account,
        balanceCashLimit: limit,
        drawerChange: drawerChangeBetween(current.drawer, drawer) ?? undefined,
        actorType: CashActorType.MACHINE,
        actorId: input.machineCode,
        remarks: change.isZero()
          ? "Cash in hand counted at machine activation"
          : `Cash in hand counted at machine activation: ${rupees(change.abs())} ${change.isNegative() ? "less" : "more"} than given by the CSP (${fromAccount ? (change.isNegative() ? "to cash in account" : "from cash in account") : change.isNegative() ? "other: decreased by the CSP" : "other: increased by the CSP"})`,
      },
    ]);

    // The drawer was counted now: open "Adjust" requests are done.
    await this.db.cashDrawerAdjustment.updateMany({
      where: { agentId: input.agentId, status: "PENDING" },
      data: { status: "COMPLETED", completedAt: new Date(), completedBy: input.machineCode, drawerAfter: drawer },
    });

    await this.repository.refreshFloatMirror(cspAgentId);

    if (!change.isZero()) {
      const agent = await this.db.agent.findUnique({
        where: { agentId: input.agentId },
        select: { name: true },
      });

      await new NotificationService(this.db).notifyAgent(cspAgentId, {
        title: "Cash in hand differs at activation",
        message: `${agent?.name ?? input.agentId} (${input.agentId}) counted ${rupees(hand)} at machine activation, ${rupees(change.abs())} ${change.isNegative() ? "less" : "more"} than the ${rupees(current.cashInHand)} you gave. ${fromAccount ? `The difference was ${change.isNegative() ? "added to" : "taken from"} cash in account.` : `Marked as other (cash ${change.isNegative() ? "decreased" : "increased"} by you): the cash limit is now ${rupees(limit)}.`}`,
        kind: NotificationKind.CASH_ACTIVATION_DIFFERENCE,
        type: NotificationType.WARNING,
        data: {
          agentId: input.agentId,
          machineCode: input.machineCode,
          given: money(current.cashInHand),
          counted: money(hand),
          difference: money(change),
          differenceSource: input.differenceSource ?? null,
        },
      });
    }

    return {
      status: "APPLIED" as const,
      cashLimit: money(limit),
      cashInAccount: money(account),
      cashInHand: money(hand),
      difference: money(change),
      differenceSource: change.isZero() ? null : input.differenceSource!,
    };
  }

  // ---------------------------------------------------------------------------
  // Receipts
  // ---------------------------------------------------------------------------

  /**
   * Applies cash receipts, in order, to the uploading agent's cash in hand
   * and drawer and to the shared cash in account. Deposit / money transfer:
   * cash in hand up, cash in account down. Withdrawal: the reverse. A receipt
   * the balances can't cover (the bank transaction already happened) is
   * saved but NOT_APPLIED and logged for the CSP, so nothing goes negative.
   */
  async applyReceipts(
    agentId: string,
    receipts: CashReceipt[],
    actor: CashActor,
  ): Promise<Map<string, ReceiptCashResult>> {
    const results = new Map<string, ReceiptCashResult>();

    const cashReceipts = receipts
      .map((receipt) => ({
        receipt,
        effect: getLedgerRule(receipt.transactionCategory)?.cashEffect,
      }))
      .filter(
        (entry) =>
          (entry.effect === CashEffect.CASH_IN ||
            entry.effect === CashEffect.CASH_OUT) &&
          entry.receipt.amount !== null &&
          entry.receipt.amount !== undefined,
      );

    if (cashReceipts.length === 0) {
      return results;
    }

    const cspAgentId = await this.repository.findPoolCspId(agentId);

    // Not part of any CSP: nothing to track.
    if (!cspAgentId) {
      return results;
    }

    const pool = await this.repository.lockPool(cspAgentId);
    const rows: Prisma.CashLedgerUncheckedCreateInput[] = [];

    if (!pool) {
      for (const { receipt } of cashReceipts) {
        results.set(receipt.receiptRecordId, {
          status: "NOT_APPLIED",
          reason: NOT_APPLIED_REASONS.NOT_SET_UP,
        });

        rows.push({
          cspAgentId,
          agentId,
          type: CashLedgerType.RECEIPT_NOT_APPLIED,
          reason: NOT_APPLIED_REASONS.NOT_SET_UP,
          transactionCategory: receipt.transactionCategory,
          amount: D(receipt.amount!),
          receiptRecordId: receipt.receiptRecordId,
          actorType: actor.type,
          actorId: actor.id,
        });
      }

      await this.repository.createLedger(rows);

      return results;
    }

    const cash = await this.repository.lockAgentCash([agentId]);
    let { cashInHand: hand, drawer } = cash.get(agentId)!;
    let account = pool.cashInAccount;

    for (const { receipt, effect } of cashReceipts) {
      const amount = D(receipt.amount!);
      const cashIn = effect === CashEffect.CASH_IN;
      const short = cashIn ? account.lessThan(amount) : hand.lessThan(amount);

      if (short) {
        const reason = cashIn
          ? NOT_APPLIED_REASONS.INSUFFICIENT_CASH_IN_ACCOUNT
          : NOT_APPLIED_REASONS.INSUFFICIENT_CASH_IN_HAND;

        results.set(receipt.receiptRecordId, { status: "NOT_APPLIED", reason });

        rows.push({
          cspAgentId,
          agentId,
          type: CashLedgerType.RECEIPT_NOT_APPLIED,
          reason,
          transactionCategory: receipt.transactionCategory,
          amount,
          balanceCashInHand: hand,
          balanceCashInAccount: account,
          balanceCashLimit: pool.cashLimit,
          receiptRecordId: receipt.receiptRecordId,
          actorType: actor.type,
          actorId: actor.id,
        });

        continue;
      }

      const handChange = cashIn ? amount : amount.negated();

      hand = hand.plus(handChange);
      account = account.minus(handChange);

      const moved = moveDrawer(drawer, receipt.cashDenomination, cashIn ? 1 : -1);

      drawer = moved.drawer;

      results.set(receipt.receiptRecordId, { status: "APPLIED" });

      rows.push({
        cspAgentId,
        agentId,
        type: CashLedgerType.RECEIPT,
        transactionCategory: receipt.transactionCategory,
        amount,
        cashInHandChange: handChange,
        cashInAccountChange: handChange.negated(),
        balanceCashInHand: hand,
        balanceCashInAccount: account,
        balanceCashLimit: pool.cashLimit,
        drawerChange: moved.change ?? undefined,
        receiptRecordId: receipt.receiptRecordId,
        actorType: actor.type,
        actorId: actor.id,
      });
    }

    await this.repository.updatePool(cspAgentId, { cashInAccount: account });
    await this.repository.updateAgentCash(agentId, hand, drawer);
    await this.repository.createLedger(rows);
    await this.repository.refreshFloatMirror(cspAgentId, agentId);

    return results;
  }

  // ---------------------------------------------------------------------------
  // CSP actions
  // ---------------------------------------------------------------------------

  /**
   * Moves cash between the shared cash in account and one agent's cash in
   * hand (either way), e.g. account → KO before a big withdrawal.
   */
  async settle(input: {
    cspAgentId: string;
    agentId: string;
    amount: number;
    direction: "ACCOUNT_TO_HAND" | "HAND_TO_ACCOUNT";
    remarks?: string;
    idempotencyKey?: string;
    actor: CashActor;
  }) {
    const pool = await this.requirePool(input.cspAgentId);

    const replay = await this.findReplay(input.cspAgentId, input.idempotencyKey, {
      type: CashLedgerType.SETTLEMENT,
      agentId: input.agentId,
      amount: D(input.amount),
    });

    if (replay) {
      return { replayed: true };
    }

    await this.requireUnitAgents(input.cspAgentId, [input.agentId]);

    const cash = await this.repository.lockAgentCash([input.agentId]);
    const current = cash.get(input.agentId)!;
    const amount = D(input.amount);
    const toHand = input.direction === "ACCOUNT_TO_HAND";

    if (toHand && pool.cashInAccount.lessThan(amount)) {
      throw new BadRequestError(
        `Not enough cash in account: ${rupees(pool.cashInAccount)} available, ${rupees(amount)} needed.`,
      );
    }

    if (!toHand && current.cashInHand.lessThan(amount)) {
      throw new BadRequestError(
        `Not enough cash in hand: ${rupees(current.cashInHand)} available, ${rupees(amount)} needed.`,
      );
    }

    const handChange = toHand ? amount : amount.negated();
    const hand = current.cashInHand.plus(handChange);
    const account = pool.cashInAccount.minus(handChange);

    await this.repository.updatePool(input.cspAgentId, { cashInAccount: account });
    await this.repository.updateAgentCash(input.agentId, hand, current.drawer);

    await this.repository.createLedger([
      {
        cspAgentId: input.cspAgentId,
        agentId: input.agentId,
        type: CashLedgerType.SETTLEMENT,
        amount,
        cashInHandChange: handChange,
        cashInAccountChange: handChange.negated(),
        balanceCashInHand: hand,
        balanceCashInAccount: account,
        balanceCashLimit: pool.cashLimit,
        idempotencyKey: input.idempotencyKey,
        actorType: input.actor.type,
        actorId: input.actor.id,
        remarks:
          input.remarks ??
          (toHand ? "Cash in account → cash in hand" : "Cash in hand → cash in account"),
      },
    ]);

    await this.repository.refreshFloatMirror(input.cspAgentId);

    return { replayed: false };
  }

  /**
   * The CSP edits the cash in account and any agent's cash in hand / drawer
   * (its own included) directly; also clears left in bank / other cash.
   * Nothing is compared: the cash limit is worked out again from the
   * result (all cash in hand + cash in account + in bank + left in bank +
   * extra cash held by dues − other cash). Nothing goes below 0. An agent
   * whose cash in hand changed without a drawer gets a mandatory "Adjust"
   * request on the desktop. With no pool yet this sets it up.
   */
  async adjust(input: {
    cspAgentId: string;
    cashInAccount?: number;
    cashLeftInBank?: number;
    cashOther?: number;
    agents?: { agentId: string; cashInHand?: number; drawer?: Partial<Drawer> }[];
    remarks: string;
    idempotencyKey?: string;
    drawerRequests?: boolean;
    actor: CashActor;
  }) {
    const pool = await this.repository.lockPool(input.cspAgentId);

    const replay = await this.findReplay(input.cspAgentId, input.idempotencyKey);

    if (replay) {
      return { replayed: true };
    }

    if (!pool && input.cashLeftInBank !== undefined) {
      throw new BadRequestError("Nothing is left in bank before cash management is set up.");
    }

    if (!pool && input.cashOther !== undefined) {
      throw new BadRequestError("There's no other cash before cash management is set up.");
    }

    const changes = input.agents ?? [];

    if (new Set(changes.map((change) => change.agentId)).size !== changes.length) {
      throw new BadRequestError("Each agent can appear only once.");
    }

    const unit = await this.requireUnitAgents(
      input.cspAgentId,
      changes.map((change) => change.agentId),
    );

    const cash = await this.repository.lockAgentCash(unit.map((agent) => agent.agentId));

    const oldLimit = pool?.cashLimit ?? ZERO;
    const oldAccount = pool?.cashInAccount ?? ZERO;
    const next = new Map<string, LockedAgentCash>();

    for (const [agentId, current] of cash) {
      const change = changes.find((item) => item.agentId === agentId);

      next.set(agentId, {
        agentId,
        cashInHand:
          change?.cashInHand !== undefined ? D(change.cashInHand) : current.cashInHand,
        drawer: change?.drawer ? drawerOf({ ...current.drawer, ...change.drawer }) : current.drawer,
      });
    }

    const totalHand = [...next.values()].reduce(
      (total, agent) => total.plus(agent.cashInHand),
      ZERO,
    );

    const account = input.cashInAccount !== undefined ? D(input.cashInAccount) : oldAccount;

    if (account.isNegative() || [...next.values()].some((agent) => agent.cashInHand.isNegative())) {
      throw new BadRequestError("Cash in hand and cash in account can't be below ₹0.00.");
    }

    const transit = pool?.cashInTransit ?? ZERO;
    const oldLeftInBank = pool?.cashLeftInBank ?? ZERO;
    const leftInBank =
      input.cashLeftInBank !== undefined ? D(input.cashLeftInBank) : oldLeftInBank;

    const oldOther = pool?.cashOther ?? ZERO;
    const other = input.cashOther !== undefined ? D(input.cashOther) : oldOther;

    const dueExtra = pool?.cashDueExtra ?? ZERO;

    // Worked out, never compared.
    const limit = totalHand.plus(account).plus(transit).plus(leftInBank).plus(dueExtra).minus(other);

    const type = pool ? CashLedgerType.ADJUSTMENT : CashLedgerType.OPENING;
    const rows: Prisma.CashLedgerUncheckedCreateInput[] = [];
    const base = {
      cspAgentId: input.cspAgentId,
      type,
      actorType: input.actor.type,
      actorId: input.actor.id,
      remarks: input.remarks,
    };

    const poolChanged =
      !pool ||
      !limit.equals(oldLimit) ||
      !account.equals(oldAccount) ||
      !leftInBank.equals(oldLeftInBank) ||
      !other.equals(oldOther);

    if (poolChanged) {
      rows.push({
        ...base,
        agentId: null,
        cashLimitChange: limit.minus(oldLimit),
        cashInAccountChange: account.minus(oldAccount),
        cashLeftInBankChange: leftInBank.minus(oldLeftInBank),
        cashOtherChange: other.minus(oldOther),
        balanceCashInAccount: account,
        balanceCashLimit: limit,
        balanceCashLeftInBank: leftInBank,
        balanceCashOther: other,
      });
    }

    const handChanged: { agentId: string; before: LockedAgentCash; after: LockedAgentCash; drawerGiven: boolean }[] = [];

    for (const [agentId, after] of next) {
      const before = cash.get(agentId)!;
      const drawerChange = drawerChangeBetween(before.drawer, after.drawer);
      const handChange = after.cashInHand.minus(before.cashInHand);

      if (handChange.isZero() && !drawerChange && pool) {
        continue;
      }

      if (!handChange.isZero()) {
        handChanged.push({
          agentId,
          before,
          after,
          drawerGiven: !!changes.find((item) => item.agentId === agentId)?.drawer,
        });
      }

      rows.push({
        ...base,
        agentId,
        cashInHandChange: handChange,
        balanceCashInHand: after.cashInHand,
        balanceCashInAccount: account,
        balanceCashLimit: limit,
        drawerChange: drawerChange ?? undefined,
      });
    }

    if (rows.length === 0) {
      throw new BadRequestError("Nothing to change.");
    }

    rows[0].idempotencyKey = input.idempotencyKey;

    if (pool) {
      await this.repository.updatePool(input.cspAgentId, {
        cashLimit: limit,
        cashInAccount: account,
        cashLeftInBank: leftInBank,
        cashOther: other,
      });
    } else {
      await this.repository.createPool(input.cspAgentId, limit, account);
    }

    for (const [agentId, after] of next) {
      const before = cash.get(agentId)!;

      if (!after.cashInHand.equals(before.cashInHand) || drawerChangeBetween(before.drawer, after.drawer)) {
        await this.repository.updateAgentCash(agentId, after.cashInHand, after.drawer);
      }
    }

    // A changed cash in hand without counted notes: the agent counts them
    // on the desktop (mandatory), when the plan has cash management.
    if (pool && input.drawerRequests !== false) {
      for (const item of handChanged) {
        if (item.drawerGiven) {
          continue;
        }

        await this.createDrawerAdjustment({
          cspAgentId: input.cspAgentId,
          agentId: item.agentId,
          source: "CSP_EDIT",
          before: item.before.cashInHand,
          after: item.after.cashInHand,
          drawer: item.before.drawer,
          remarks: input.remarks,
          requestedBy: input.actor.id ?? "SYSTEM",
        });
      }
    }

    await this.repository.createLedger(rows);
    await this.repository.refreshFloatMirror(input.cspAgentId);

    return { replayed: false };
  }

  /**
   * Increase / decrease (app button): the CSP brings cash in or takes it out
   * of one agent's cash in hand, or of the shared cash in account. The cash
   * limit moves with it; nothing is compared with it. A cash in hand change
   * creates a mandatory "Adjust" request for that agent on the desktop (the
   * notes given / taken). The CSP's own cash in hand only when it has a
   * running machine (its desktop counts the notes); otherwise it uses cash
   * in account.
   */
  async changeCash(input: {
    cspAgentId: string;
    target: "CASH_IN_HAND" | "CASH_IN_ACCOUNT";
    agentId?: string;
    direction: "INCREASE" | "DECREASE";
    amount: number;
    remarks: string;
    idempotencyKey?: string;
    actor: CashActor;
  }) {
    const pool = await this.requirePool(input.cspAgentId);

    const replay = await this.findReplay(input.cspAgentId, input.idempotencyKey);

    if (replay) {
      return { replayed: true };
    }

    const amount = D(input.amount);
    const signed = input.direction === "INCREASE" ? amount : amount.negated();
    const type = input.direction === "INCREASE" ? CashLedgerType.INCREASE : CashLedgerType.DECREASE;
    const limit = pool.cashLimit.plus(signed);

    if (input.target === "CASH_IN_ACCOUNT") {
      const account = pool.cashInAccount.plus(signed);

      if (account.isNegative()) {
        throw new BadRequestError(
          `Not enough cash in account: ${rupees(pool.cashInAccount)} available, ${rupees(amount)} to take out.`,
        );
      }

      await this.repository.updatePool(input.cspAgentId, { cashInAccount: account, cashLimit: limit });

      await this.repository.createLedger([
        {
          cspAgentId: input.cspAgentId,
          agentId: null,
          type,
          reason: "CASH_IN_ACCOUNT",
          amount,
          cashInAccountChange: signed,
          cashLimitChange: signed,
          balanceCashInAccount: account,
          balanceCashLimit: limit,
          idempotencyKey: input.idempotencyKey,
          actorType: input.actor.type,
          actorId: input.actor.id,
          remarks: input.remarks,
        },
      ]);

      await this.repository.refreshFloatMirror(input.cspAgentId);

      return { replayed: false, adjustment: null };
    }

    if (!input.agentId) {
      throw new BadRequestError("agentId is required to change an agent's cash in hand.");
    }

    await this.requireUnitAgents(input.cspAgentId, [input.agentId]);

    if (input.agentId === input.cspAgentId && !(await this.hasRunningMachine(input.agentId))) {
      throw new BadRequestError(
        "You don't have a running machine, so your cash in hand isn't counted on a desktop. Change the cash in account instead.",
        "CSP_HAND_NEEDS_MACHINE",
      );
    }

    const cash = await this.repository.lockAgentCash([input.agentId]);
    const current = cash.get(input.agentId)!;
    const hand = current.cashInHand.plus(signed);

    if (hand.isNegative()) {
      throw new BadRequestError(
        `Not enough cash in hand: ${rupees(current.cashInHand)} available, ${rupees(amount)} to take out.`,
      );
    }

    await this.repository.updateAgentCash(input.agentId, hand, current.drawer);
    await this.repository.updatePool(input.cspAgentId, { cashLimit: limit });

    await this.repository.createLedger([
      {
        cspAgentId: input.cspAgentId,
        agentId: input.agentId,
        type,
        reason: "CASH_IN_HAND",
        amount,
        cashInHandChange: signed,
        cashLimitChange: signed,
        balanceCashInHand: hand,
        balanceCashInAccount: pool.cashInAccount,
        balanceCashLimit: limit,
        idempotencyKey: input.idempotencyKey,
        actorType: input.actor.type,
        actorId: input.actor.id,
        remarks: input.remarks,
      },
    ]);

    const adjustment = await this.createDrawerAdjustment({
      cspAgentId: input.cspAgentId,
      agentId: input.agentId,
      source: input.direction === "INCREASE" ? "CSP_INCREASE" : "CSP_DECREASE",
      before: current.cashInHand,
      after: hand,
      drawer: current.drawer,
      remarks: input.remarks,
      requestedBy: input.actor.id ?? "SYSTEM",
    });

    await this.repository.refreshFloatMirror(input.cspAgentId);

    return { replayed: false, adjustment };
  }

  // ---------------------------------------------------------------------------
  // "Adjust" requests (CSP changed an agent's cash in hand → the agent counts
  // the notes on the desktop)
  // ---------------------------------------------------------------------------

  async createDrawerAdjustment(input: {
    cspAgentId: string;
    agentId: string;
    source: "KO_CREATION" | "CSP_EDIT" | "CSP_INCREASE" | "CSP_DECREASE";
    before: Prisma.Decimal;
    after: Prisma.Decimal;
    drawer: Drawer;
    remarks?: string;
    requestedBy: string;
  }) {
    const row = await this.db.cashDrawerAdjustment.create({
      data: {
        cspAgentId: input.cspAgentId,
        agentId: input.agentId,
        source: input.source,
        cashInHandBefore: input.before,
        cashInHandAfter: input.after,
        amount: input.after.minus(input.before),
        drawerBefore: input.drawer,
        remarks: input.remarks,
        requestedBy: input.requestedBy,
      },
    });

    return this.mapAdjustment(row);
  }

  async listDrawerAdjustments(filter: { agentIds: string[]; status?: "PENDING" | "COMPLETED" | "CANCELLED" }) {
    const rows = await this.db.cashDrawerAdjustment.findMany({
      where: { agentId: { in: filter.agentIds }, ...(filter.status && { status: filter.status }) },
      orderBy: { createdAt: filter.status === "PENDING" ? "asc" : "desc" },
      take: 100,
    });

    return rows.map((row) => this.mapAdjustment(row));
  }

  /**
   * The agent counted the notes for the CSP's change(s): either the whole
   * drawer (`drawer`) or only the notes given / taken (`notes`, applied in
   * the direction of the change). The drawer must then total the agent's
   * current cash in hand. Completes every open request of the agent.
   */
  async completeDrawerAdjustment(input: {
    agentId: string;
    adjustmentId: string;
    drawer?: Partial<Drawer>;
    notes?: Partial<Drawer>;
    machineCode: string;
  }) {
    const cspAgentId = await this.repository.findPoolCspId(input.agentId);

    if (!cspAgentId) {
      throw new BadRequestError("This agent isn't part of a CSP.");
    }

    await this.requirePool(cspAgentId);

    const cash = await this.repository.lockAgentCash([input.agentId]);
    const current = cash.get(input.agentId)!;

    const adjustment = await this.db.cashDrawerAdjustment.findFirst({
      where: { id: input.adjustmentId, agentId: input.agentId },
    });

    if (!adjustment) {
      throw new NotFoundError("Adjust request not found.");
    }

    if (adjustment.status !== "PENDING") {
      throw new ConflictError("This adjust request is already done.", "ADJUSTMENT_NOT_PENDING");
    }

    if (!input.drawer && !input.notes) {
      throw new BadRequestError("Send the counted drawer or the notes given / taken.", "DENOMINATION_REQUIRED");
    }

    const drawer = input.drawer
      ? drawerOf(input.drawer)
      : moveDrawer(current.drawer, input.notes, D(adjustment.amount).isNegative() ? -1 : 1).drawer;

    if (Math.round(drawerTotal(drawer) * 100) !== Math.round(money(current.cashInHand) * 100)) {
      throw new BadRequestError(
        `The notes' total (₹${drawerTotal(drawer).toFixed(2)}) must equal your cash in hand (${rupees(current.cashInHand)}).`,
      );
    }

    const change = drawerChangeBetween(current.drawer, drawer);

    await this.repository.updateAgentCash(input.agentId, current.cashInHand, drawer);

    await this.repository.createLedger([
      {
        cspAgentId,
        agentId: input.agentId,
        type: CashLedgerType.DRAWER_ADJUSTED,
        balanceCashInHand: current.cashInHand,
        drawerChange: change ?? undefined,
        actorType: CashActorType.MACHINE,
        actorId: input.machineCode,
        remarks: "Notes counted for the CSP's cash in hand change",
      },
    ]);

    await this.db.cashDrawerAdjustment.updateMany({
      where: { agentId: input.agentId, status: "PENDING" },
      data: { status: "COMPLETED", completedAt: new Date(), completedBy: input.machineCode, drawerAfter: drawer },
    });

    return {
      cashInHand: money(current.cashInHand),
      drawer,
      drawerTotal: drawerTotal(drawer),
    };
  }

  /** Open adjust requests block the agent's other desktop cash writes. */
  async requireNoPendingAdjustment(agentId: string) {
    const pending = await this.db.cashDrawerAdjustment.count({
      where: { agentId, status: "PENDING" },
    });

    if (pending > 0) {
      throw new ConflictError(
        "Count the notes for your CSP's cash change first (Adjust request).",
        "ADJUSTMENT_PENDING",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // KO removed / replaced
  // ---------------------------------------------------------------------------

  /**
   * A deleted KO's cash in hand and drawer leave the pool (the cash limit
   * goes down by it). Refused while it has open dues or an open settlement.
   */
  async removeAgent(input: { cspAgentId: string; agentId: string; actor: CashActor }) {
    const pool = await this.repository.lockPool(input.cspAgentId);

    const [openDues, openSettlements] = await Promise.all([
      this.db.cashDue.count({ where: { agentId: input.agentId, status: "OPEN" } }),
      this.db.cashSettlement.count({ where: { agentId: input.agentId, status: "PENDING" } }),
    ]);

    if (openDues > 0 || openSettlements > 0) {
      throw new ConflictError(
        "This KO still has open balance dues or an open settlement. Settle them (or replace the KO) before deleting it.",
        "KO_HAS_OPEN_CASH",
      );
    }

    const cash = await this.repository.lockAgentCash([input.agentId]);
    const current = cash.get(input.agentId)!;

    await this.db.cashDrawerAdjustment.updateMany({
      where: { agentId: input.agentId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    if (current.cashInHand.isZero() && drawerTotal(current.drawer) === 0) {
      return { removed: ZERO };
    }

    await this.repository.updateAgentCash(input.agentId, ZERO, emptyDrawer());

    if (pool) {
      const limit = pool.cashLimit.minus(current.cashInHand);

      await this.repository.updatePool(input.cspAgentId, { cashLimit: limit });

      await this.repository.createLedger([
        {
          cspAgentId: input.cspAgentId,
          agentId: input.agentId,
          type: CashLedgerType.AGENT_REMOVED,
          cashInHandChange: current.cashInHand.negated(),
          cashLimitChange: current.cashInHand.negated(),
          balanceCashInHand: ZERO,
          balanceCashInAccount: pool.cashInAccount,
          balanceCashLimit: limit,
          drawerChange: drawerChangeBetween(current.drawer, emptyDrawer()) ?? undefined,
          actorType: input.actor.type,
          actorId: input.actor.id,
          remarks: "KO deleted: its cash in hand left the pool",
        },
      ]);

      await this.repository.refreshFloatMirror(input.cspAgentId);
    }

    return { removed: current.cashInHand };
  }

  /**
   * KO replaced: the old KO's cash in hand, drawer, open dues, tasks, open
   * settlements and adjust requests move to the new KO. The cash limit
   * doesn't change.
   */
  async transferAgent(input: { cspAgentId: string; fromAgentId: string; toAgentId: string; actor: CashActor }) {
    const pool = await this.repository.lockPool(input.cspAgentId);
    const cash = await this.repository.lockAgentCash([input.fromAgentId, input.toAgentId]);
    const from = cash.get(input.fromAgentId)!;
    const to = cash.get(input.toAgentId)!;

    const hand = to.cashInHand.plus(from.cashInHand);
    const drawer = moveDrawer(to.drawer, from.drawer, 1).drawer;

    await this.repository.updateAgentCash(input.toAgentId, hand, drawer);
    await this.repository.updateAgentCash(input.fromAgentId, ZERO, emptyDrawer());

    const moved = { agentId: input.toAgentId };

    await Promise.all([
      this.db.cashDue.updateMany({ where: { agentId: input.fromAgentId, status: "OPEN" }, data: moved }),
      this.db.cashTask.updateMany({ where: { agentId: input.fromAgentId, done: false }, data: moved }),
      this.db.cashSettlement.updateMany({ where: { agentId: input.fromAgentId, status: "PENDING" }, data: moved }),
      this.db.cashDrawerAdjustment.updateMany({ where: { agentId: input.fromAgentId, status: "PENDING" }, data: moved }),
    ]);

    if (pool) {
      const base = {
        cspAgentId: input.cspAgentId,
        type: CashLedgerType.AGENT_TRANSFERRED,
        balanceCashInAccount: pool.cashInAccount,
        balanceCashLimit: pool.cashLimit,
        actorType: input.actor.type,
        actorId: input.actor.id,
      };

      await this.repository.createLedger([
        {
          ...base,
          agentId: input.fromAgentId,
          cashInHandChange: from.cashInHand.negated(),
          balanceCashInHand: ZERO,
          drawerChange: drawerChangeBetween(from.drawer, emptyDrawer()) ?? undefined,
          remarks: `KO replaced by ${input.toAgentId}: cash moved to the new KO`,
        },
        {
          ...base,
          agentId: input.toAgentId,
          cashInHandChange: from.cashInHand,
          balanceCashInHand: hand,
          drawerChange: drawerChangeBetween(to.drawer, drawer) ?? undefined,
          remarks: `Replaces KO ${input.fromAgentId}: took over its cash`,
        },
      ]);

      await this.repository.refreshFloatMirror(input.cspAgentId);
    }

    return { cashInHand: money(hand) };
  }

  // ---------------------------------------------------------------------------
  // Desktop one-step move between cash in hand and cash in account
  // ---------------------------------------------------------------------------

  /**
   * The simple form of a settlement: the agent moves cash between its cash
   * in hand and the shared cash in account in one step (the notes given /
   * taken must total the amount). The cash limit doesn't change.
   */
  async transfer(input: {
    agentId: string;
    direction: "HAND_TO_ACCOUNT" | "ACCOUNT_TO_HAND";
    amount: number;
    drawer: Partial<Drawer>;
    remarks?: string;
    machineCode: string;
  }) {
    const cspAgentId = await this.repository.findPoolCspId(input.agentId);

    if (!cspAgentId) {
      throw new BadRequestError("This agent isn't part of a CSP.");
    }

    const pool = await this.requirePool(cspAgentId);
    const cash = await this.repository.lockAgentCash([input.agentId]);
    const current = cash.get(input.agentId)!;
    const amount = D(input.amount);
    const toHand = input.direction === "ACCOUNT_TO_HAND";
    const notes = drawerOf(input.drawer);

    if (Math.round(drawerTotal(notes) * 100) !== Math.round(money(amount) * 100)) {
      throw new BadRequestError(
        `The notes' total (₹${drawerTotal(notes).toFixed(2)}) must equal the amount (${rupees(amount)}).`,
      );
    }

    if (toHand && pool.cashInAccount.lessThan(amount)) {
      throw new BadRequestError(
        `Not enough cash in account: ${rupees(pool.cashInAccount)} available, ${rupees(amount)} needed.`,
      );
    }

    if (!toHand && current.cashInHand.lessThan(amount)) {
      throw new BadRequestError(
        `Not enough cash in hand: ${rupees(current.cashInHand)} available, ${rupees(amount)} needed.`,
      );
    }

    if (!toHand) {
      for (const key of DRAWER_KEYS) {
        if (notes[key] > current.drawer[key]) {
          throw new BadRequestError(`Not enough ₹${key.replace(/\D/g, "")} ${key.startsWith("coins") ? "coins" : "notes"} in the drawer.`);
        }
      }
    }

    const handChange = toHand ? amount : amount.negated();
    const hand = current.cashInHand.plus(handChange);
    const account = pool.cashInAccount.minus(handChange);
    const moved = moveDrawer(current.drawer, notes, toHand ? 1 : -1);

    await this.repository.updatePool(cspAgentId, { cashInAccount: account });
    await this.repository.updateAgentCash(input.agentId, hand, moved.drawer);

    await this.repository.createLedger([
      {
        cspAgentId,
        agentId: input.agentId,
        type: CashLedgerType.TRANSFER,
        amount,
        cashInHandChange: handChange,
        cashInAccountChange: handChange.negated(),
        balanceCashInHand: hand,
        balanceCashInAccount: account,
        balanceCashLimit: pool.cashLimit,
        drawerChange: moved.change ?? undefined,
        actorType: CashActorType.MACHINE,
        actorId: input.machineCode,
        remarks: input.remarks ?? (toHand ? "Cash in account → cash in hand" : "Cash in hand → cash in account"),
      },
    ]);

    await this.repository.refreshFloatMirror(cspAgentId);

    return {
      cashInHand: money(hand),
      cashInAccount: money(account),
      drawer: moved.drawer,
      drawerTotal: drawerTotal(moved.drawer),
    };
  }

  private async hasRunningMachine(agentId: string) {
    const count = await this.db.activation.count({
      where: { assignedAgentId: agentId, status: "ACTIVE", isCurrent: true, machineId: { not: null } },
    });

    return count > 0;
  }

  private mapAdjustment(row: {
    id: string;
    cspAgentId: string;
    agentId: string;
    source: string;
    status: string;
    cashInHandBefore: Prisma.Decimal;
    cashInHandAfter: Prisma.Decimal;
    amount: Prisma.Decimal;
    drawerBefore: Prisma.JsonValue;
    drawerAfter: Prisma.JsonValue;
    remarks: string | null;
    requestedBy: string;
    completedAt: Date | null;
    completedBy: string | null;
    createdAt: Date;
  }) {
    const amount = D(row.amount);

    return {
      id: row.id,
      cspAgentId: row.cspAgentId,
      agentId: row.agentId,
      source: row.source,
      status: row.status,
      // GIVEN: the CSP gave cash (count the notes added); TAKEN: took it.
      kind: amount.isNegative() ? "TAKEN" : "GIVEN",
      amount: money(amount.abs()),
      cashInHandBefore: money(D(row.cashInHandBefore)),
      cashInHandAfter: money(D(row.cashInHandAfter)),
      drawerBefore: row.drawerBefore,
      drawerAfter: row.drawerAfter,
      mandatory: true,
      remarks: row.remarks,
      requestedBy: row.requestedBy,
      completedAt: row.completedAt,
      completedBy: row.completedBy,
      createdAt: row.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // KO change requests (desktop → CSP approval)
  // ---------------------------------------------------------------------------

  async createRequest(input: {
    agentId: string;
    cashInHand: number;
    drawer?: Partial<Drawer>;
    reason: string;
    requestedBy: string;
  }) {
    const cspAgentId = await this.repository.findPoolCspId(input.agentId);

    if (!cspAgentId) {
      throw new BadRequestError("This agent isn't part of a CSP.");
    }

    await this.requirePool(cspAgentId);

    // Locks the agent's row, so two requests can't both pass the check.
    const cash = await this.repository.lockAgentCash([input.agentId]);

    const pending = await this.db.cashRequest.findFirst({
      where: { agentId: input.agentId, status: CashRequestStatus.PENDING },
    });

    if (pending) {
      throw new ConflictError(
        "A cash change request is already pending for this agent. Wait for the CSP to review it.",
      );
    }

    const request = await this.db.cashRequest.create({
      data: {
        cspAgentId,
        agentId: input.agentId,
        requestedCashInHand: D(input.cashInHand),
        systemCashInHand: cash.get(input.agentId)!.cashInHand,
        requestedDrawer: input.drawer ? drawerOf(input.drawer) : undefined,
        reason: input.reason,
        requestedBy: input.requestedBy,
      },
    });

    const system = cash.get(input.agentId)!.cashInHand;

    await notifyCspOfKo(this.db, {
      cspAgentId,
      agentId: input.agentId,
      kind: NotificationKind.CASH_REQUEST_RAISED,
      title: "Cash change request",
      message: (ko) => `${ko} asks to change cash in hand from ${rupees(system)} to ${rupees(D(input.cashInHand))}: ${input.reason}. Review it in Cash.`,
      type: NotificationType.WARNING,
      data: { requestId: request.id, systemCashInHand: system.toFixed(2), requestedCashInHand: D(input.cashInHand).toFixed(2) },
    });

    return this.mapRequest(request);
  }

  async reviewRequest(input: {
    cspAgentId: string;
    requestId: string;
    action: "APPROVE" | "REJECT";
    remarks?: string;
    actor: CashActor;
  }) {
    const request = await this.db.cashRequest.findFirst({
      where: { id: input.requestId, cspAgentId: input.cspAgentId },
    });

    if (!request) {
      throw new NotFoundError("Cash request not found.");
    }

    const review = {
      reviewedBy: input.actor.id,
      reviewedAt: new Date(),
      reviewRemarks: input.remarks,
    };

    if (input.action === "REJECT") {
      const result = await this.db.cashRequest.updateMany({
        where: { id: request.id, status: CashRequestStatus.PENDING },
        data: { status: CashRequestStatus.REJECTED, ...review },
      });

      if (result.count === 0) {
        throw new ConflictError("This request has already been reviewed.");
      }

      return this.mapRequest(
        (await this.db.cashRequest.findUnique({ where: { id: request.id } }))!,
      );
    }

    const pool = await this.requirePool(input.cspAgentId);

    if ((await this.repository.findPoolCspId(request.agentId)) !== input.cspAgentId) {
      throw new ConflictError("This agent is no longer part of this CSP.");
    }

    const cash = await this.repository.lockAgentCash([request.agentId]);

    // Re-read under the lock: a concurrent review may have finished first.
    const fresh = await this.db.cashRequest.findUnique({ where: { id: request.id } });

    if (fresh?.status !== CashRequestStatus.PENDING) {
      throw new ConflictError("This request has already been reviewed.");
    }

    const current = cash.get(request.agentId)!;
    const hand = D(request.requestedCashInHand);
    const handChange = hand.minus(current.cashInHand);
    const account = pool.cashInAccount.minus(handChange);

    if (account.isNegative()) {
      throw new BadRequestError(
        `Not enough cash in account to approve: ${rupees(pool.cashInAccount)} available, ${rupees(handChange)} needed. Raise the cash limit first.`,
      );
    }

    const drawer = request.requestedDrawer
      ? drawerOf(request.requestedDrawer as Partial<Drawer>)
      : current.drawer;

    await this.repository.updatePool(input.cspAgentId, { cashInAccount: account });
    await this.repository.updateAgentCash(request.agentId, hand, drawer);

    await this.repository.createLedger([
      {
        cspAgentId: input.cspAgentId,
        agentId: request.agentId,
        type: CashLedgerType.REQUEST_APPROVED,
        cashInHandChange: handChange,
        cashInAccountChange: handChange.negated(),
        balanceCashInHand: hand,
        balanceCashInAccount: account,
        balanceCashLimit: pool.cashLimit,
        drawerChange: drawerChangeBetween(current.drawer, drawer) ?? undefined,
        requestId: request.id,
        actorType: input.actor.type,
        actorId: input.actor.id,
        remarks: input.remarks ?? request.reason,
      },
    ]);

    await this.db.cashRequest.update({
      where: { id: request.id },
      data: { status: CashRequestStatus.APPROVED, ...review },
    });

    await this.repository.refreshFloatMirror(input.cspAgentId);

    return this.mapRequest(
      (await this.db.cashRequest.findUnique({ where: { id: request.id } }))!,
    );
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** The pool with every agent's cash in hand and drawer, and the totals. */
  async getView(cspAgentId: string, onlyAgentIds?: string[]) {
    const [view] = await this.getViews([cspAgentId], onlyAgentIds);

    return view;
  }

  /**
   * Views for several pools in a fixed number of queries (BC dashboards).
   * `onlyAgentIds` limits the agents shown (and the totals) to those.
   */
  async getViews(cspAgentIds: string[], onlyAgentIds?: string[]) {
    if (cspAgentIds.length === 0) {
      return [];
    }

    const [pools, unitAgents, pending, openSettlements] = await Promise.all([
      this.db.cashPool.findMany({ where: { cspAgentId: { in: cspAgentIds } } }),
      this.db.agent.findMany({
        where: {
          isDeleted: false,
          OR: [
            { agentId: { in: cspAgentIds }, type: "CSP" },
            { parentAgentId: { in: cspAgentIds }, type: "KO" },
          ],
        },
        select: { agentId: true, name: true, type: true, parentAgentId: true },
        orderBy: [{ type: "asc" }, { agentId: "asc" }],
      }),
      this.db.cashRequest.groupBy({
        by: ["cspAgentId"],
        where: { cspAgentId: { in: cspAgentIds }, status: CashRequestStatus.PENDING },
        _count: { _all: true },
      }),
      this.db.cashSettlement.groupBy({
        by: ["cspAgentId"],
        where: { cspAgentId: { in: cspAgentIds }, status: "PENDING" },
        _count: { _all: true },
      }),
    ]);

    const shown = onlyAgentIds
      ? unitAgents.filter((agent) => onlyAgentIds.includes(agent.agentId))
      : unitAgents;

    const shownIds = shown.map((agent) => agent.agentId);

    const [cashRows, running, adjustments, pendingCounts] = await Promise.all([
      this.repository.findAgentCash(shownIds),
      this.db.activation.findMany({
        where: {
          assignedAgentId: { in: shownIds },
          status: "ACTIVE",
          isCurrent: true,
          machineId: { not: null },
        },
        select: { assignedAgentId: true },
      }),
      this.db.cashDrawerAdjustment.groupBy({
        by: ["agentId"],
        where: { agentId: { in: shownIds }, status: "PENDING" },
        _count: { _all: true },
      }),
      this.db.receipt.groupBy({
        by: ["agentId"],
        where: { agentId: { in: shownIds }, denominationPending: true },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const cash = new Map(cashRows.map((row) => [row.agentId, row]));
    const counts = new Map(pendingCounts.map((row) => [row.agentId, row]));
    const withMachine = new Set(running.map((row) => row.assignedAgentId));

    return cspAgentIds.map((cspAgentId) => {
      const pool = pools.find((item) => item.cspAgentId === cspAgentId);
      const agents = shown.filter(
        (agent) =>
          agent.agentId === cspAgentId || agent.parentAgentId === cspAgentId,
      );
      const merged = emptyDrawer();
      let totalHand = ZERO;

      const items = agents.map((agent) => {
        const row = cash.get(agent.agentId);
        const hand = row ? D(row.cashInHand) : ZERO;
        const drawer = row ? drawerOf(row) : emptyDrawer();

        totalHand = totalHand.plus(hand);

        for (const key of DRAWER_KEYS) {
          merged[key] += drawer[key];
        }

        return {
          agentId: agent.agentId,
          name: agent.name,
          type: agent.type,
          cashInHand: money(hand),
          drawer,
          drawerTotal: drawerTotal(drawer),
          drawerMatchesCashInHand: drawerTotal(drawer) === money(hand),
          // Has a running PC (its desktop counts notes; the CSP's own cash
          // in hand can be increased / decreased only then).
          machineActive: withMachine.has(agent.agentId),
          // Open "Adjust" requests (notes to count on the desktop).
          pendingAdjustments:
            adjustments.find((item) => item.agentId === agent.agentId)?._count._all ?? 0,
          // Cash receipts the agent uploaded without notes ("Count needed").
          pendingCounts: {
            count: counts.get(agent.agentId)?._count._all ?? 0,
            amount: money(D(counts.get(agent.agentId)?._sum.amount ?? 0)),
          },
        };
      });

      return {
        cspAgentId,
        cspName:
          unitAgents.find((agent) => agent.agentId === cspAgentId)?.name ?? null,
        setUp: !!pool,
        cashLimit: pool ? money(D(pool.cashLimit)) : null,
        cashInAccount: pool ? money(D(pool.cashInAccount)) : null,
        // Held in bank by open KO settlements (step 1 done, step 2 pending).
        cashInTransit: pool ? money(D(pool.cashInTransit)) : null,
        // Left in bank by partly delivered KO settlements, shown separately.
        cashLeftInBank: pool ? money(D(pool.cashLeftInBank)) : null,
        // Net cash from custom transactions and dues (+ in, − out), shown separately.
        cashOther: pool ? money(D(pool.cashOther)) : null,
        // Open "extra cash" dues (+ to collect, − to give), part of the books rule.
        cashDueExtra: pool ? money(D(pool.cashDueExtra)) : null,
        totalCashInHand: money(totalHand),
        // Balance due held in the books (open extra-cash dues), part of the limit.
        balanceDue: pool ? money(D(pool.cashDueExtra)) : null,
        drawer: merged,
        drawerTotal: drawerTotal(merged),
        agents: items,
        pendingRequests:
          pending.find((item) => item.cspAgentId === cspAgentId)?._count._all ?? 0,
        // Settlements the KOs have open (the CSP is only informed).
        openSettlements:
          openSettlements.find((item) => item.cspAgentId === cspAgentId)?._count._all ?? 0,
        updatedAt: pool?.updatedAt ?? null,
      };
    });
  }

  /** What the desktop caches (heartbeat): its own cash, read-only. */
  async getMachineCash(agentId: string | null) {
    const cspAgentId = agentId ? await this.repository.findPoolCspId(agentId) : null;

    if (!agentId || !cspAgentId) {
      return null;
    }

    const [pool, row, lastRequest, dues, openSettlement, tasks, pendingCounts] = await Promise.all([
      this.repository.findPool(cspAgentId),
      this.db.agentCash.findUnique({ where: { agentId } }),
      this.db.cashRequest.findFirst({
        where: { agentId },
        orderBy: { createdAt: "desc" },
      }),
      new CashDeskService(this.db).dueTotals(agentId),
      new CashSettlementService(this.db).openStepSummary(agentId),
      new CashTaskService(this.db).counts(agentId),
      new CashReceiptCountService(this.db).pendingSummary(agentId),
    ]);

    const drawer = row ? drawerOf(row) : emptyDrawer();

    return {
      setUp: !!pool,
      cspAgentId,
      agentId,
      cashLimit: pool ? money(D(pool.cashLimit)) : null,
      cashInAccount: pool ? money(D(pool.cashInAccount)) : null,
      cashInTransit: pool ? money(D(pool.cashInTransit)) : null,
      cashLeftInBank: pool ? money(D(pool.cashLeftInBank)) : null,
      cashOther: pool ? money(D(pool.cashOther)) : null,
      cashDueExtra: pool ? money(D(pool.cashDueExtra)) : null,
      cashInHand: money(row ? D(row.cashInHand) : ZERO),
      drawer,
      drawerTotal: drawerTotal(drawer),
      lastRequest: lastRequest ? this.mapRequest(lastRequest) : null,
      // Open balance dues: { toCollect, toGive, openCount, bySide }.
      dues,
      // What's waiting for the KO: its open settlement step, and tasks.
      openSettlement,
      tasks,
      // Cash receipts uploaded without their notes ("Count needed" badge).
      pendingCounts,
      // Mandatory: count the notes for the CSP's cash in hand changes first.
      pendingAdjustments: await this.listDrawerAdjustments({ agentIds: [agentId], status: "PENDING" }),
      updatedAt: (row?.updatedAt ?? pool?.updatedAt ?? null) as Date | null,
    };
  }

  async listLedger(filter: {
    cspAgentId: string;
    agentIds?: string[];
    types?: CashLedgerType[];
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }) {
    const where: Prisma.CashLedgerWhereInput = {
      cspAgentId: filter.cspAgentId,
      ...(filter.agentIds && { agentId: { in: filter.agentIds } }),
      ...(filter.types && { type: { in: filter.types } }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.db.cashLedger.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: {
          agent: { select: { name: true, type: true } },
          receipt: { select: { receiptId: true } },
        },
      }),
      this.db.cashLedger.count({ where }),
    ]);

    const num = (value: Prisma.Decimal | null) => (value === null ? null : money(D(value)));

    return {
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        reason: item.reason,
        agentId: item.agentId,
        agentName: item.agent?.name ?? null,
        agentType: item.agent?.type ?? null,
        transactionCategory: item.transactionCategory,
        amount: num(item.amount),
        cashInHandChange: money(D(item.cashInHandChange)),
        cashInAccountChange: money(D(item.cashInAccountChange)),
        cashLimitChange: money(D(item.cashLimitChange)),
        cashInTransitChange: money(D(item.cashInTransitChange)),
        cashLeftInBankChange: money(D(item.cashLeftInBankChange)),
        cashOtherChange: money(D(item.cashOtherChange)),
        cashDueExtraChange: money(D(item.cashDueExtraChange)),
        balanceCashInHand: num(item.balanceCashInHand),
        balanceCashInAccount: num(item.balanceCashInAccount),
        balanceCashLimit: num(item.balanceCashLimit),
        balanceCashInTransit: num(item.balanceCashInTransit),
        balanceCashLeftInBank: num(item.balanceCashLeftInBank),
        balanceCashOther: num(item.balanceCashOther),
        balanceCashDueExtra: num(item.balanceCashDueExtra),
        drawerChange: item.drawerChange,
        receiptId: item.receipt?.receiptId ?? null,
        requestId: item.requestId,
        settlementId: item.settlementId,
        actorType: item.actorType,
        actorId: item.actorId,
        remarks: item.remarks,
        createdAt: item.createdAt,
      })),
      pagination: {
        page: filter.page,
        limit: filter.limit,
        total,
        totalPages: Math.ceil(total / filter.limit),
      },
    };
  }

  async listRequests(filter: {
    cspAgentId: string;
    status?: CashRequestStatus;
    agentIds?: string[];
    page: number;
    limit: number;
  }) {
    const where: Prisma.CashRequestWhereInput = {
      cspAgentId: filter.cspAgentId,
      ...(filter.status && { status: filter.status }),
      ...(filter.agentIds && { agentId: { in: filter.agentIds } }),
    };

    const [items, total] = await Promise.all([
      this.db.cashRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.db.cashRequest.count({ where }),
    ]);

    return {
      items: items.map((item) => this.mapRequest(item)),
      pagination: {
        page: filter.page,
        limit: filter.limit,
        total,
        totalPages: Math.ceil(total / filter.limit),
      },
    };
  }

  // ---------------------------------------------------------------------------

  private async requirePool(cspAgentId: string): Promise<LockedPool> {
    const pool = await this.repository.lockPool(cspAgentId);

    if (!pool) {
      throw new BadRequestError(NOT_SET_UP_MESSAGE);
    }

    return pool;
  }

  private async requireUnitAgents(cspAgentId: string, agentIds: string[]) {
    const unit = await this.repository.findUnitAgents(cspAgentId);
    const ids = new Set(unit.map((agent) => agent.agentId));

    for (const agentId of agentIds) {
      if (!ids.has(agentId)) {
        throw new BadRequestError(`Agent ${agentId} isn't part of this CSP.`);
      }
    }

    return unit;
  }

  /**
   * A retried request (same Idempotency-Key) returns without applying
   * again. Must run after the pool lock. Same key, different request → 409.
   */
  private async findReplay(
    cspAgentId: string,
    idempotencyKey: string | undefined,
    expected?: { type: CashLedgerType; agentId: string; amount: Prisma.Decimal },
  ) {
    if (!idempotencyKey) {
      return null;
    }

    const existing = await this.repository.findLedgerByIdempotencyKey(
      cspAgentId,
      idempotencyKey,
    );

    if (!existing) {
      return null;
    }

    if (
      expected &&
      (existing.type !== expected.type ||
        existing.agentId !== expected.agentId ||
        !D(existing.amount ?? 0).equals(expected.amount))
    ) {
      throw new ConflictError(
        "This Idempotency-Key was already used for a different request.",
      );
    }

    return existing;
  }

  private mapRequest(request: {
    id: string;
    cspAgentId: string;
    agentId: string;
    requestedCashInHand: Prisma.Decimal;
    systemCashInHand: Prisma.Decimal;
    requestedDrawer: Prisma.JsonValue;
    reason: string;
    status: CashRequestStatus;
    requestedBy: string;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    reviewRemarks: string | null;
    createdAt: Date;
  }) {
    return {
      id: request.id,
      cspAgentId: request.cspAgentId,
      agentId: request.agentId,
      requestedCashInHand: money(D(request.requestedCashInHand)),
      systemCashInHand: money(D(request.systemCashInHand)),
      requestedDrawer: request.requestedDrawer,
      reason: request.reason,
      status: request.status,
      requestedBy: request.requestedBy,
      reviewedBy: request.reviewedBy,
      reviewedAt: request.reviewedAt,
      reviewRemarks: request.reviewRemarks,
      createdAt: request.createdAt,
    };
  }
}
