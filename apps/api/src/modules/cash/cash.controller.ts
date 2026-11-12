import { Request, Response } from "express";

import { withReadOnly, withTransaction } from "../../core/database/transaction";
import { PrismaDb } from "../../core/database/prisma.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ForbiddenError } from "../../core/errors/ForbiddenError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { CurrentUser } from "../../core/types/auth.types";
import { CashTaskCreator, UserRole } from "../../generated/prisma/enums";
import AgentScopeService from "../agents/service/agent-scope.service";
import { resolveDateRange } from "../reports/helper/report.helper";
import SubscriptionEntitlementService from "../subscriptions/subscription-entitlement.service";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";

import CashRepository from "./cash.repository";
import CashService from "./cash.service";
import CashSettlementService from "./cash-settlement.service";
import CashDeskService from "./cash-desk.service";
import CashDayService from "./cash-day.service";
import { CashLabelService, CashTaskService } from "./cash-task.service";
import {
  cashAdjustmentsQuerySchema,
  cashAgentQuerySchema,
  cashDayClosesQuerySchema,
  cashDuesQuerySchema,
  cashLabelChangeSchema,
  cashLabelSchema,
  cashTasksQuerySchema,
  cspTaskChangeSchema,
  cspTaskSchema,
  cashLedgerQuerySchema,
  cashRequestsQuerySchema,
  cashSettlementsQuerySchema,
  cashTransactionSchema,
  cashViewSchema,
  reviewCashRequestSchema,
} from "./cash.validation";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_\-:.]{8,128}$/;

async function requireCashManagement(db: PrismaDb, user: CurrentUser) {
  const subscription = await new SubscriptionResolver(db).getEffectiveSubscription(
    user.agentId,
  );

  SubscriptionAccessValidator.validate(subscription);

  if (!(await new SubscriptionEntitlementService(db).canViewCashManagement(subscription))) {
    throw new ForbiddenError("Your subscription does not include cash management.");
  }
}

/**
 * The pool to work on. A CSP works on its own pool (`agentId` may pick one
 * of its KOs to show on its own). A BC or super admin names a CSP or KO in
 * scope with `agentId`.
 */
async function resolvePool(db: PrismaDb, user: CurrentUser, agentId?: string) {
  await requireCashManagement(db, user);

  const scopeService = new AgentScopeService(db);
  const scope = await scopeService.getAgentScope(user);

  if (agentId) {
    scopeService.ensureAgentAccessible(agentId, scope);
  }

  let cspAgentId: string | null = user.agentId;

  if (user.role !== UserRole.CSP_ADMIN) {
    if (!agentId) {
      throw new BadRequestError("agentId is required (a CSP or one of its KOs).");
    }

    cspAgentId = await new CashRepository(db).findPoolCspId(agentId);
  }

  if (!cspAgentId) {
    throw new BadRequestError("This agent isn't part of a CSP.");
  }

  return {
    cspAgentId,
    // One agent on its own, or the whole CSP (CSP + KOs merged).
    onlyAgentIds: agentId && agentId !== cspAgentId ? [agentId] : undefined,
  };
}

function idempotencyKeyOf(req: Request) {
  const key = req.get("Idempotency-Key")?.trim();

  if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) {
    throw new BadRequestError(
      "Idempotency-Key must be 8–128 letters, digits, '-', '_', ':' or '.'.",
    );
  }

  return key;
}

export const getCash = async (req: Request, res: Response) => {
  const query = cashViewSchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const pool = await resolvePool(tx, req.user!, query.agentId);

    return new CashService(tx).getView(pool.cspAgentId, pool.onlyAgentIds);
  });

  return res.status(200).json({
    success: true,
    message: "Cash details fetched successfully.",
    data: req.user!.role === UserRole.BC_ADMIN ? withoutOtherCash(data) : data,
  });
};

export const createTransaction = async (req: Request, res: Response) => {
  const body = cashTransactionSchema.parse(req.body);
  const idempotencyKey = idempotencyKeyOf(req);
  const actor = { type: "USER" as const, id: req.user!.userId };

  const result = await withTransaction(async (tx) => {
    await requireCashManagement(tx, req.user!);

    const service = new CashService(tx);
    const cspAgentId = req.user!.agentId;

    let outcome: { replayed: boolean; adjustment?: unknown };

    if (body.type === "INCREASE" || body.type === "DECREASE") {
      outcome = await service.changeCash({
        cspAgentId,
        target: body.target,
        agentId: body.agentId,
        direction: body.type,
        amount: body.amount,
        remarks: body.remarks,
        idempotencyKey,
        actor,
      });
    } else if (body.type === "SETTLEMENT") {
      outcome = await service.settle({
        cspAgentId,
        agentId: body.agentId,
        amount: body.amount,
        direction: body.direction,
        remarks: body.remarks,
        idempotencyKey,
        actor,
      });
    } else if (body.type === "ADJUSTMENT") {
      outcome = await service.adjust({
        cspAgentId,
        cashInAccount: body.cashInAccount,
        cashLeftInBank: body.cashLeftInBank,
        cashOther: body.cashOther,
        agents: body.agents,
        remarks: body.remarks,
        idempotencyKey,
        actor,
      });
    } else {
      throw new BadRequestError("Unknown transaction type.");
    }

    return { ...outcome, view: await service.getView(cspAgentId) };
  });

  return res.status(result.replayed ? 200 : 201).json({
    success: true,
    message: result.replayed
      ? "Already recorded (same Idempotency-Key)."
      : body.type === "SETTLEMENT"
        ? "Settlement recorded."
        : body.type === "INCREASE" || body.type === "DECREASE"
          ? body.target === "CASH_IN_HAND"
            ? `Cash in hand ${body.type === "INCREASE" ? "increased" : "decreased"}. The agent counts the notes on the desktop (Adjust request).`
            : `Cash in account ${body.type === "INCREASE" ? "increased" : "decreased"}.`
          : "Cash adjusted.",
    data: result.view,
  });
};

export const getLedger = async (req: Request, res: Response) => {
  const query = cashLedgerQuerySchema.parse(req.query);
  const dates = query.period
    ? resolveDateRange(query.period, query.from, query.to)
    : { from: query.from, to: query.to };

  const data = await withReadOnly(async (tx) => {
    const pool = await resolvePool(tx, req.user!, query.agentId);

    return new CashService(tx).listLedger({
      cspAgentId: pool.cspAgentId,
      agentIds: query.agentIds ?? pool.onlyAgentIds,
      types: query.types,
      ...dates,
      page: query.page,
      limit: query.limit,
    });
  });

  return res.status(200).json({
    success: true,
    message: "Cash ledger fetched successfully.",
    data,
  });
};

/** The KOs' settlements: the CSP's notification feed (no approval). */
export const getSettlements = async (req: Request, res: Response) => {
  const query = cashSettlementsQuerySchema.parse(req.query);
  const dates = query.period
    ? resolveDateRange(query.period, query.from, query.to)
    : { from: query.from, to: query.to };

  const data = await withReadOnly(async (tx) => {
    const pool = await resolvePool(tx, req.user!, query.agentId);

    return new CashSettlementService(tx).list({
      cspAgentId: pool.cspAgentId,
      agentIds: query.agentIds ?? pool.onlyAgentIds,
      status: query.status,
      ...dates,
      page: query.page,
      limit: query.limit,
    });
  });

  return res.status(200).json({
    success: true,
    message: "Settlements fetched successfully.",
    data,
  });
};

export const getRequests = async (req: Request, res: Response) => {
  const query = cashRequestsQuerySchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const pool = await resolvePool(tx, req.user!, query.agentId);

    return new CashService(tx).listRequests({
      cspAgentId: pool.cspAgentId,
      status: query.status,
      agentIds: pool.onlyAgentIds,
      page: query.page,
      limit: query.limit,
    });
  });

  return res.status(200).json({
    success: true,
    message: "Cash requests fetched successfully.",
    data,
  });
};

export const reviewRequest = async (req: Request, res: Response) => {
  const body = reviewCashRequestSchema.parse(req.body);

  const data = await withTransaction(async (tx) => {
    await requireCashManagement(tx, req.user!);

    return new CashService(tx).reviewRequest({
      cspAgentId: req.user!.agentId,
      requestId: req.params.requestId as string,
      action: body.action,
      remarks: body.remarks,
      actor: { type: "USER", id: req.user!.userId },
    });
  });

  return res.status(200).json({
    success: true,
    message: body.action === "APPROVE" ? "Request approved." : "Request rejected.",
    data,
  });
};

/** The pool's agents (CSP + KOs), or just the one picked with `agentId`. */
async function unitAgentsOf(db: PrismaDb, pool: { cspAgentId: string; onlyAgentIds?: string[] }) {
  const agents = await new CashRepository(db).findUnitAgents(pool.cspAgentId);

  return pool.onlyAgentIds
    ? agents.filter((agent) => pool.onlyAgentIds!.includes(agent.agentId))
    : agents;
}

// -----------------------------------------------------------------------------
// Labels for the KOs' custom transactions (the CSP creates them)
// -----------------------------------------------------------------------------

export const getLabels = async (req: Request, res: Response) => {
  const query = cashAgentQuerySchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const pool = await resolvePool(tx, req.user!, query.agentId);
    const labels = await new CashLabelService(tx).list(pool.cspAgentId);
    const desk = new CashDeskService(tx);

    return labels.map((label) => desk.mapLabel(label));
  });

  return res.status(200).json({ success: true, message: "Labels fetched successfully.", data });
};

export const createLabel = async (req: Request, res: Response) => {
  const body = cashLabelSchema.parse(req.body);

  const data = await withTransaction(async (tx) => {
    await requireCashManagement(tx, req.user!);

    const label = await new CashLabelService(tx).create(req.user!.agentId, body);

    return new CashDeskService(tx).mapLabel(label);
  });

  return res.status(201).json({ success: true, message: "Label created.", data });
};

export const updateLabel = async (req: Request, res: Response) => {
  const body = cashLabelChangeSchema.parse(req.body);

  const data = await withTransaction(async (tx) => {
    await requireCashManagement(tx, req.user!);

    const label = await new CashLabelService(tx).update(
      req.user!.agentId,
      req.params.labelId as string,
      body,
    );

    return new CashDeskService(tx).mapLabel(label);
  });

  return res.status(200).json({ success: true, message: "Label updated.", data });
};

// -----------------------------------------------------------------------------
// The agents' balance due and day closes (read-only)
// -----------------------------------------------------------------------------

export const getDues = async (req: Request, res: Response) => {
  const query = cashDuesQuerySchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const pool = await resolvePool(tx, req.user!, query.agentId);
    const agents = await unitAgentsOf(tx, pool);

    return new CashDeskService(tx).listDues(
      agents.map((agent) => agent.agentId),
      query.status,
    );
  });

  return res.status(200).json({ success: true, message: "Dues fetched successfully.", data });
};

/** One due with its history. */
export const getDue = async (req: Request, res: Response) => {
  const query = cashAgentQuerySchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const pool = await resolvePool(tx, req.user!, query.agentId);
    const agents = await unitAgentsOf(tx, { cspAgentId: pool.cspAgentId });

    return new CashDeskService(tx).getDue(
      req.params.dueId as string,
      agents.map((agent) => agent.agentId),
    );
  });

  return res.status(200).json({ success: true, message: "Due fetched successfully.", data });
};

export const getDayCloses = async (req: Request, res: Response) => {
  const query = cashDayClosesQuerySchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const pool = await resolvePool(tx, req.user!, query.agentId);

    return new CashDayService(tx).listForCsp({
      agents: await unitAgentsOf(tx, pool),
      from: query.from,
      to: query.to,
    });
  });

  return res.status(200).json({ success: true, message: "Day closes fetched successfully.", data });
};

// -----------------------------------------------------------------------------
// Tasks: the CSP sees every agent's and manages the ones it gave
// -----------------------------------------------------------------------------

export const getTasks = async (req: Request, res: Response) => {
  const query = cashTasksQuerySchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const pool = await resolvePool(tx, req.user!, query.agentId);
    const agents = await unitAgentsOf(tx, pool);

    return new CashTaskService(tx).list(
      agents.map((agent) => agent.agentId),
      query.status,
    );
  });

  return res.status(200).json({ success: true, message: "Tasks fetched successfully.", data });
};

export const createTask = async (req: Request, res: Response) => {
  const body = cspTaskSchema.parse(req.body);

  const data = await withTransaction(async (tx) => {
    const pool = await resolvePool(tx, req.user!);
    const agents = await unitAgentsOf(tx, pool);

    if (!agents.some((agent) => agent.agentId === body.agentId)) {
      throw new NotFoundError("Agent not found.");
    }

    return new CashTaskService(tx).create({
      cspAgentId: pool.cspAgentId,
      agentId: body.agentId,
      title: body.title,
      note: body.note || null,
      dueAt: body.dueAt ?? null,
      createdBy: CashTaskCreator.CSP,
      createdById: req.user!.userId,
    });
  });

  return res.status(201).json({ success: true, message: "Task added.", data });
};

export const updateTask = async (req: Request, res: Response) => {
  const body = cspTaskChangeSchema.parse(req.body);

  const data = await withTransaction(async (tx) => {
    const pool = await resolvePool(tx, req.user!);
    const agents = await unitAgentsOf(tx, pool);

    return new CashTaskService(tx).update({
      taskId: req.params.taskId as string,
      agentIds: agents.map((agent) => agent.agentId),
      by: CashTaskCreator.CSP,
      change: { ...body, note: body.note === "" ? null : body.note },
    });
  });

  return res.status(200).json({ success: true, message: "Task updated.", data });
};

export const deleteTask = async (req: Request, res: Response) => {
  await withTransaction(async (tx) => {
    const pool = await resolvePool(tx, req.user!);
    const agents = await unitAgentsOf(tx, pool);

    await new CashTaskService(tx).remove({
      taskId: req.params.taskId as string,
      agentIds: agents.map((agent) => agent.agentId),
      by: CashTaskCreator.CSP,
    });
  });

  return res.status(200).json({ success: true, message: "Task deleted." });
};

/** A BC sees the cash limit and its distribution, not the CSP's other cash. */
function withoutOtherCash<T>(data: T): T {
  const strip = (pool: Record<string, unknown>) => {
    const { cashOther: _other, cashDueExtra: _dueExtra, ...rest } = pool;

    return rest;
  };

  return (Array.isArray(data) ? data.map(strip) : strip(data as Record<string, unknown>)) as T;
}

/** Adjust requests (the agents counting notes for the CSP's cash changes). */
export const getAdjustments = async (req: Request, res: Response) => {
  const query = cashAdjustmentsQuerySchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const pool = await resolvePool(tx, req.user!, query.agentId);
    const agentIds =
      pool.onlyAgentIds ??
      (await new CashRepository(tx).findUnitAgents(pool.cspAgentId)).map((agent) => agent.agentId);

    return new CashService(tx).listDrawerAdjustments({ agentIds, status: query.status });
  });

  return res.status(200).json({ success: true, message: "Adjust requests fetched successfully.", data });
};
