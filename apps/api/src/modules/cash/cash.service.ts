import { PrismaDb } from "../../core/database/prisma.types";
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
import CashRepository, { LockedAgentCash, LockedPool } from "./cash.repository";
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
  | { status: "APPLIED" }
  | { status: "NOT_APPLIED"; reason: NotAppliedReason };

/**
 * Cash management for a CSP and its KOs. They share one cash limit and one
 * cash in account (the pool); each has its own cash in hand and drawer, and
 * cash in account + all cash in hand = cash limit. Every change is written to
 * CashLedger. Write methods must run inside a transaction: they lock the pool
 * first, so changes to one pool apply one after the other.
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
   * Opens the CSP's pool (signup, or a BC creating the CSP). Cash in hand +
   * cash in account must equal the cash limit. An existing pool with nothing
   * recorded but its opening (e.g. signup sent again) is reset; once anything
   * else is recorded it's KEPT as it is.
   */
  async openPool(input: {
    cspAgentId: string;
    cashLimit: number;
    cashInAccount: number;
    cashInHand: number;
    actor: CashActor;
  }): Promise<"CREATED" | "UPDATED" | "KEPT"> {
    const limit = D(input.cashLimit);
    const account = D(input.cashInAccount);
    const hand = D(input.cashInHand);

    if (!hand.plus(account).equals(limit)) {
      throw new BadRequestError(
        `Cash in hand + cash in account must equal the CSP limit (${rupees(hand)} + ${rupees(account)} ≠ ${rupees(limit)}).`,
      );
    }

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
   * A KO joins its CSP's pool with its own cash in hand, which comes out of
   * the shared cash in account. NOT_SET_UP when the CSP has no pool yet; the
   * CSP sets the KO's cash in hand when setting up.
   */
  async addAgent(input: {
    cspAgentId: string;
    agentId: string;
    cashInHand: number;
    actor: CashActor;
  }): Promise<"ADDED" | "NOT_SET_UP"> {
    const pool = await this.repository.lockPool(input.cspAgentId);

    if (!pool) {
      return "NOT_SET_UP";
    }

    const cash = await this.repository.lockAgentCash([input.agentId]);
    const current = cash.get(input.agentId)!;
    const hand = D(input.cashInHand);
    const change = hand.minus(current.cashInHand);
    const account = pool.cashInAccount.minus(change);

    if (account.isNegative()) {
      throw new BadRequestError(
        `Not enough cash in account for this KO's cash in hand: ${rupees(pool.cashInAccount)} available, ${rupees(change)} needed. Raise the CSP limit or settle cash first.`,
      );
    }

    await this.repository.updatePool(input.cspAgentId, {
      cashInAccount: account,
    });

    await this.repository.updateAgentCash(input.agentId, hand, current.drawer);

    await this.repository.createLedger([
      {
        cspAgentId: input.cspAgentId,
        agentId: input.agentId,
        type: CashLedgerType.AGENT_ADDED,
        cashInHandChange: change,
        cashInAccountChange: change.negated(),
        balanceCashInHand: hand,
        balanceCashInAccount: account,
        balanceCashLimit: pool.cashLimit,
        actorType: input.actor.type,
        actorId: input.actor.id,
        remarks: "KO added with opening cash in hand",
      },
    ]);

    await this.repository.refreshFloatMirror(input.cspAgentId);

    return "ADDED";
  }

  /**
   * Machine activation: the agent counts its cash in hand and drawer, which
   * replace the stored ones; cash in account changes by the difference. The
   * caller has checked that the drawer total equals the cash in hand.
   * Before the CSP sets up cash management the count is SAVED as the
   * agent's cash in hand; setting up takes it into account. NOT_SET_UP when
   * the agent isn't part of a CSP (nothing is kept).
   */
  async setCashAtActivation(input: {
    agentId: string;
    cashInHand: number;
    drawer: Partial<Drawer>;
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

    if (!pool) {
      const drawer = drawerOf(input.drawer);

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
    const account = pool.cashInAccount.minus(change);

    if (account.isNegative()) {
      throw new BadRequestError(
        `Not enough cash in account for this cash in hand: ${rupees(pool.cashInAccount)} available, ${rupees(change)} needed. Ask the CSP to settle cash or raise the limit.`,
      );
    }

    const drawer = drawerOf(input.drawer);

    await this.repository.updatePool(cspAgentId, { cashInAccount: account });
    await this.repository.updateAgentCash(input.agentId, hand, drawer);

    await this.repository.createLedger([
      {
        cspAgentId,
        agentId: input.agentId,
        type: CashLedgerType.ACTIVATION,
        cashInHandChange: change,
        cashInAccountChange: change.negated(),
        balanceCashInHand: hand,
        balanceCashInAccount: account,
        balanceCashLimit: pool.cashLimit,
        drawerChange: drawerChangeBetween(current.drawer, drawer) ?? undefined,
        actorType: CashActorType.MACHINE,
        actorId: input.machineCode,
        remarks: "Cash in hand counted at machine activation",
      },
    ]);

    await this.repository.refreshFloatMirror(cspAgentId);

    return {
      status: "APPLIED" as const,
      cashLimit: money(pool.cashLimit),
      cashInAccount: money(account),
      cashInHand: money(hand),
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
   * Sets the cash limit, cash in account, and agents' cash in hand / drawer.
   * A new limit without a new cash in account moves cash in account by the
   * difference. The result must keep cash in account + all cash in hand =
   * cash limit, with nothing below 0. With no pool yet this sets it up
   * (cashLimit and cashInAccount are then required).
   */
  async adjust(input: {
    cspAgentId: string;
    cashLimit?: number;
    cashInAccount?: number;
    cashLeftInBank?: number;
    cashOther?: number;
    agents?: { agentId: string; cashInHand?: number; drawer?: Partial<Drawer> }[];
    remarks: string;
    idempotencyKey?: string;
    actor: CashActor;
  }) {
    const pool = await this.repository.lockPool(input.cspAgentId);

    const replay = await this.findReplay(input.cspAgentId, input.idempotencyKey);

    if (replay) {
      return { replayed: true };
    }

    if (!pool && input.cashLimit === undefined) {
      throw new BadRequestError(
        "Cash management isn't set up yet: send cashLimit (and cashInAccount, each agent's cashInHand) to set it up.",
      );
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
    const limit = input.cashLimit !== undefined ? D(input.cashLimit) : oldLimit;
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

    // Setting up without cashInAccount: the rest of the limit after every
    // agent's cash in hand (incl. counts saved at PC activation).
    const account =
      input.cashInAccount !== undefined
        ? D(input.cashInAccount)
        : pool
          ? oldAccount.plus(limit.minus(oldLimit))
          : limit.minus(totalHand);

    if (account.isNegative()) {
      throw new BadRequestError(
        pool
          ? `Cash in account can't go below ₹0.00: lowering the limit to ${rupees(limit)} needs ${rupees(limit.minus(oldLimit).negated())} from cash in account, which has ${rupees(oldAccount)}.`
          : `The cash limit (${rupees(limit)}) is less than the agents' cash in hand (${rupees(totalHand)} in total).`,
      );
    }

    const transit = pool?.cashInTransit ?? ZERO;
    const oldLeftInBank = pool?.cashLeftInBank ?? ZERO;
    const leftInBank =
      input.cashLeftInBank !== undefined ? D(input.cashLeftInBank) : oldLeftInBank;

    const oldOther = pool?.cashOther ?? ZERO;
    const other = input.cashOther !== undefined ? D(input.cashOther) : oldOther;

    const dueExtra = pool?.cashDueExtra ?? ZERO;

    if (!totalHand.plus(account).plus(transit).plus(leftInBank).plus(dueExtra).equals(limit.plus(other))) {
      throw new BadRequestError(
        `Cash in hand (${rupees(totalHand)} in total) + cash in account (${rupees(account)})${transit.isZero() ? "" : ` + in bank (${rupees(transit)}, open settlements)`}${leftInBank.isZero() ? "" : ` + left in bank (${rupees(leftInBank)})`}${dueExtra.isZero() ? "" : ` ${dueExtra.isNegative() ? "−" : "+"} extra cash held by dues (${rupees(dueExtra.abs())})`} must equal the cash limit (${rupees(limit)})${other.isZero() ? "" : ` ${other.isNegative() ? "−" : "+"} other cash (${rupees(other.abs())}, custom transactions and dues)`}.`,
      );
    }

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

    for (const [agentId, after] of next) {
      const before = cash.get(agentId)!;
      const drawerChange = drawerChangeBetween(before.drawer, after.drawer);
      const handChange = after.cashInHand.minus(before.cashInHand);

      if (handChange.isZero() && !drawerChange && pool) {
        continue;
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

    await this.repository.createLedger(rows);
    await this.repository.refreshFloatMirror(input.cspAgentId);

    return { replayed: false };
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

    const cash = new Map(
      (await this.repository.findAgentCash(shown.map((agent) => agent.agentId))).map(
        (row) => [row.agentId, row],
      ),
    );

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

    const [pool, row, lastRequest, dues, openSettlement, tasks] = await Promise.all([
      this.repository.findPool(cspAgentId),
      this.db.agentCash.findUnique({ where: { agentId } }),
      this.db.cashRequest.findFirst({
        where: { agentId },
        orderBy: { createdAt: "desc" },
      }),
      new CashDeskService(this.db).dueTotals(agentId),
      new CashSettlementService(this.db).openStepSummary(agentId),
      new CashTaskService(this.db).counts(agentId),
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
