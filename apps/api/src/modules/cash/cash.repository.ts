import { PrismaDb } from "../../core/database/prisma.types";
import { Prisma } from "../../generated/prisma/client";
import { AgentType, CashLabelDirection } from "../../generated/prisma/enums";

import { Drawer, drawerOf } from "./cash.constants";

/** Labels a new pool starts with; the CSP renames or deactivates them. */
const DEFAULT_LABELS = [
  { name: "Other", direction: CashLabelDirection.BOTH },
  { name: "Shop expense", direction: CashLabelDirection.OUT },
  { name: "Bill collection", direction: CashLabelDirection.IN },
  { name: "Recharge", direction: CashLabelDirection.IN },
];

export interface LockedPool {
  cspAgentId: string;
  cashLimit: Prisma.Decimal;
  cashInAccount: Prisma.Decimal;
  cashInTransit: Prisma.Decimal;
  cashLeftInBank: Prisma.Decimal;
  cashOther: Prisma.Decimal;
  cashDueExtra: Prisma.Decimal;
}

export interface LockedAgentCash {
  agentId: string;
  cashInHand: Prisma.Decimal;
  drawer: Drawer;
}

export default class CashRepository {
  constructor(private readonly db: PrismaDb) {}

  /**
   * The CSP whose pool an agent uses: a CSP its own, a KO its parent's.
   * Null for other agents (BC, admin) and KOs without a CSP.
   */
  async findPoolCspId(agentId: string) {
    const agent = await this.db.agent.findUnique({
      where: { agentId },
      select: { agentId: true, type: true, parentAgentId: true },
    });

    if (!agent) {
      return null;
    }

    if (agent.type === AgentType.CSP) {
      return agent.agentId;
    }

    return agent.type === AgentType.KO ? agent.parentAgentId : null;
  }

  /** The CSP and its active KOs: the agents sharing the pool. */
  findUnitAgents(cspAgentId: string) {
    return this.db.agent.findMany({
      where: {
        isDeleted: false,
        OR: [
          { agentId: cspAgentId, type: AgentType.CSP },
          { parentAgentId: cspAgentId, type: AgentType.KO },
        ],
      },
      select: { agentId: true, name: true, type: true },
      orderBy: [{ type: "asc" }, { agentId: "asc" }],
    });
  }

  findPool(cspAgentId: string) {
    return this.db.cashPool.findUnique({ where: { cspAgentId } });
  }

  findAgentCash(agentIds: string[]) {
    return this.db.agentCash.findMany({
      where: { agentId: { in: agentIds } },
    });
  }

  /**
   * Row lock on the pool until the transaction ends. Every writer locks the
   * pool first, so changes to one pool apply one after the other.
   */
  async lockPool(cspAgentId: string): Promise<LockedPool | null> {
    const rows = await this.db.$queryRaw<LockedPool[]>`
      SELECT "cspAgentId", "cashLimit", "cashInAccount", "cashInTransit", "cashLeftInBank", "cashOther", "cashDueExtra"
      FROM "CashPool" WHERE "cspAgentId" = ${cspAgentId}
      FOR UPDATE
    `;

    return rows[0] ?? null;
  }

  /** Creates missing rows (cash in hand 0), then locks them in id order. */
  async lockAgentCash(agentIds: string[]) {
    const ids = [...new Set(agentIds)].sort();

    if (ids.length === 0) {
      return new Map<string, LockedAgentCash>();
    }

    await this.db.agentCash.createMany({
      data: ids.map((agentId) => ({ agentId })),
      skipDuplicates: true,
    });

    const rows = await this.db.$queryRaw<
      (Record<string, unknown> & { agentId: string; cashInHand: Prisma.Decimal })[]
    >`
      SELECT * FROM "AgentCash" WHERE "agentId" = ANY(${ids}::text[])
      ORDER BY "agentId"
      FOR UPDATE
    `;

    return new Map(
      rows.map((row) => [
        row.agentId,
        {
          agentId: row.agentId,
          cashInHand: new Prisma.Decimal(row.cashInHand),
          drawer: drawerOf(row as Partial<Drawer>),
        },
      ]),
    );
  }

  /** Opens the pool with a few editable labels for the KOs' custom transactions. */
  async createPool(cspAgentId: string, cashLimit: Prisma.Decimal, cashInAccount: Prisma.Decimal) {
    const pool = await this.db.cashPool.create({
      data: { cspAgentId, cashLimit, cashInAccount },
    });

    await this.db.cashLabel.createMany({
      data: DEFAULT_LABELS.map((label) => ({ cspAgentId, ...label })),
      skipDuplicates: true,
    });

    return pool;
  }

  updatePool(
    cspAgentId: string,
    data: {
      cashLimit?: Prisma.Decimal;
      cashInAccount?: Prisma.Decimal;
      cashInTransit?: Prisma.Decimal;
      cashLeftInBank?: Prisma.Decimal;
      cashOther?: Prisma.Decimal;
      cashDueExtra?: Prisma.Decimal;
    },
  ) {
    return this.db.cashPool.update({ where: { cspAgentId }, data });
  }

  updateAgentCash(agentId: string, cashInHand: Prisma.Decimal, drawer: Drawer) {
    return this.db.agentCash.update({
      where: { agentId },
      data: { cashInHand, ...drawer },
    });
  }

  createLedger(data: Prisma.CashLedgerUncheckedCreateInput[]) {
    return this.db.cashLedger.createMany({ data });
  }

  findLedgerByIdempotencyKey(cspAgentId: string, idempotencyKey: string) {
    return this.db.cashLedger.findUnique({
      where: { cspAgentId_idempotencyKey: { cspAgentId, idempotencyKey } },
    });
  }

  countLedger(cspAgentId: string, where: Prisma.CashLedgerWhereInput = {}) {
    return this.db.cashLedger.count({ where: { cspAgentId, ...where } });
  }

  /** Deletes the pool's opening entries (re-opening an unused pool). */
  deleteOpeningLedger(cspAgentId: string) {
    return this.db.cashLedger.deleteMany({
      where: { cspAgentId, type: "OPENING" },
    });
  }

  /**
   * Keeps the older AgentFloat rows (read by dashboards, machine lists and
   * reports) in step with the pool, for the agents given or the whole unit:
   * cash in hand per agent, the shared cash in account, total = cash limit.
   */
  async refreshFloatMirror(cspAgentId: string, receiptAgentId?: string) {
    await this.db.$executeRaw`
      INSERT INTO "AgentFloat" (
        "id", "agentId", "openingFloat", "currentCashInHand",
        "currentCashInAccount", "currentTotalFloat", "approvalStatus",
        "lastReceiptAt", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid()::text, c."agentId", p."cashLimit", c."cashInHand",
        p."cashInAccount", p."cashLimit", 'APPROVED',
        CASE WHEN c."agentId" = ${receiptAgentId ?? null} THEN CURRENT_TIMESTAMP END,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM "AgentCash" c
      JOIN "Agent" a ON a."agentId" = c."agentId"
      JOIN "CashPool" p ON p."cspAgentId" = ${cspAgentId}
      WHERE a."agentId" = ${cspAgentId}
         OR (a."parentAgentId" = ${cspAgentId} AND a."type" = 'KO')
      ON CONFLICT ("agentId") DO UPDATE SET
        "openingFloat" = EXCLUDED."openingFloat",
        "currentCashInHand" = EXCLUDED."currentCashInHand",
        "currentCashInAccount" = EXCLUDED."currentCashInAccount",
        "currentTotalFloat" = EXCLUDED."currentTotalFloat",
        "lastReceiptAt" = COALESCE(EXCLUDED."lastReceiptAt", "AgentFloat"."lastReceiptAt"),
        "updatedAt" = CURRENT_TIMESTAMP
    `;
  }
}

