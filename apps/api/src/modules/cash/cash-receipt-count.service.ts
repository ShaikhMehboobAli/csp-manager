import { PrismaDb } from "../../core/database/prisma.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ConflictError } from "../../core/errors/ConflictError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { Prisma } from "../../generated/prisma/client";
import { CashActorType, CashLedgerType } from "../../generated/prisma/enums";
import { CashEffect } from "../float/config/ledger-rule.config";
import { getLedgerRule } from "../float/config/ledger-rule.helper";

import { DRAWER_KEYS, DRAWER_VALUES, Drawer, drawerOf, drawerTotal } from "./cash.constants";
import { D, ZERO, money, rupees } from "./cash.helpers";
import CashRepository from "./cash.repository";

export type ReceiptCountStatus = "PENDING" | "DONE" | "ALL";

/** Words for the ledger remarks. */
const LABELS: Record<string, string> = {
  CASH_WITHDRAWAL: "cash withdrawal",
  CASH_DEPOSIT: "cash deposit",
  MONEY_TRANSFER: "money transfer",
};

/** True when a denomination has no notes at all (missing or all zero). */
export function isEmptyDenomination(denomination: Partial<Drawer> | null | undefined) {
  return !denomination || DRAWER_KEYS.every((key) => !denomination[key]);
}

/**
 * "Count needed": a cash receipt (withdrawal, deposit, money transfer) the
 * desktop uploaded without its notes. The balances moved at upload; the
 * drawer moves only when the agent fills the count here (ledger
 * RECEIPT_COUNT, drawer only). A NOT_APPLIED receipt never needs one.
 */
export default class CashReceiptCountService {
  private readonly repository: CashRepository;

  constructor(private readonly db: PrismaDb) {
    this.repository = new CashRepository(db);
  }

  async list(agentId: string, status: ReceiptCountStatus = "PENDING") {
    const where: Prisma.ReceiptWhereInput = {
      agentId,
      ...(status === "PENDING" && { denominationPending: true }),
      ...(status === "DONE" && { denominationCountedAt: { not: null } }),
      ...(status === "ALL" && { OR: [{ denominationPending: true }, { denominationCountedAt: { not: null } }] }),
    };

    const rows = await this.db.receipt.findMany({
      where,
      orderBy: { transactionAt: "asc" },
      take: 200,
      include: { cashDenomination: true },
    });

    return rows.map((row) => ({
      receiptId: row.receiptId,
      agentId: row.agentId,
      transactionCategory: row.transactionCategory,
      transactionType: row.transactionType,
      amount: row.amount === null ? null : money(D(row.amount)),
      transactionAt: row.transactionAt,
      rrn: row.rrn,
      status: row.denominationPending ? "PENDING" : "DONE",
      countedAt: row.denominationCountedAt,
      cashDenomination: row.cashDenomination ? drawerOf(row.cashDenomination) : null,
    }));
  }

  /** For the heartbeat badge and the day close warning. */
  async pendingSummary(agentId: string) {
    const result = await this.db.receipt.aggregate({
      where: { agentId, denominationPending: true },
      _count: { _all: true },
      _sum: { amount: true },
    });

    return { count: result._count._all, amount: money(D(result._sum.amount ?? ZERO)) };
  }

  /** The agent enters the notes of a receipt uploaded without them. */
  async fill(input: { agentId: string; receiptId: string; cashDenomination: Drawer; machineCode: string }) {
    const receipt = await this.db.receipt.findUnique({
      where: { agentId_receiptId: { agentId: input.agentId, receiptId: input.receiptId } },
    });

    if (!receipt) {
      throw new NotFoundError("Receipt not found.", "RECEIPT_NOT_FOUND");
    }

    const effect = getLedgerRule(receipt.transactionCategory)?.cashEffect;
    const cashOut = effect === CashEffect.CASH_OUT;
    const amount = D(receipt.amount ?? 0);
    const notes = drawerOf(input.cashDenomination);
    const total = D(drawerTotal(notes));
    const label = LABELS[receipt.transactionCategory] ?? "receipt";

    if (!receipt.denominationPending) {
      throw new ConflictError("This receipt's notes are already counted.", "RECEIPT_COUNT_NOT_PENDING");
    }

    if (!total.equals(amount)) {
      throw new BadRequestError(
        `The notes' total (${rupees(total)}) must equal the ${label} amount (${rupees(amount)}).`,
      );
    }

    // Locks the agent's drawer: fills of the same agent run one at a time.
    const cspAgentId = await this.repository.findPoolCspId(input.agentId);
    const cash = await this.repository.lockAgentCash([input.agentId]);
    const current = cash.get(input.agentId)!;

    if (cashOut) {
      for (const key of DRAWER_KEYS) {
        if (notes[key] > current.drawer[key]) {
          throw new BadRequestError(
            `Not enough ₹${DRAWER_VALUES[key]} ${key.startsWith("coins") ? "coins" : "notes"} in the drawer.`,
          );
        }
      }
    }

    // Claims it last: a second fill that got here at the same time finds it done.
    const { count } = await this.db.receipt.updateMany({
      where: { id: receipt.id, denominationPending: true },
      data: { denominationPending: false, denominationCountedAt: new Date() },
    });

    if (count === 0) {
      throw new ConflictError("This receipt's notes are already counted.", "RECEIPT_COUNT_NOT_PENDING");
    }

    const sign = cashOut ? -1 : 1;
    const drawer = { ...current.drawer };
    const change: Partial<Drawer> = {};

    for (const key of DRAWER_KEYS) {
      if (notes[key]) {
        drawer[key] += sign * notes[key];
        change[key] = sign * notes[key];
      }
    }

    await this.repository.updateAgentCash(input.agentId, current.cashInHand, drawer);

    await this.db.receiptCashDenomination.upsert({
      where: { receiptRecordId: receipt.id },
      create: { receiptRecordId: receipt.id, ...notes },
      update: notes,
    });

    if (cspAgentId) {
      await this.repository.createLedger([
        {
          cspAgentId,
          agentId: input.agentId,
          type: CashLedgerType.RECEIPT_COUNT,
          transactionCategory: receipt.transactionCategory,
          amount,
          balanceCashInHand: current.cashInHand,
          drawerChange: Object.keys(change).length > 0 ? change : undefined,
          receiptRecordId: receipt.id,
          actorType: CashActorType.MACHINE,
          actorId: input.machineCode,
          remarks: `Notes for ${label} ${rupees(amount)}`,
        },
      ]);
    }

    return {
      receiptId: receipt.receiptId,
      status: "DONE" as const,
      cash: { cashInHand: money(current.cashInHand), drawer, drawerTotal: drawerTotal(drawer) },
    };
  }
}
