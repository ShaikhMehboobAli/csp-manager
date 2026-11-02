import { Request, Response } from "express";

import { withReadOnly, withTransaction } from "../../core/database/transaction";
import { PrismaDb } from "../../core/database/prisma.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ForbiddenError } from "../../core/errors/ForbiddenError";
import { CurrentUser } from "../../core/types/auth.types";
import { UserRole } from "../../generated/prisma/enums";
import AgentScopeService from "../agents/service/agent-scope.service";
import { resolveDateRange } from "../reports/helper/report.helper";
import SubscriptionEntitlementService from "../subscriptions/subscription-entitlement.service";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";

import CashRepository from "./cash.repository";
import CashService from "./cash.service";
import CashSettlementService from "./cash-settlement.service";
import {
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
    data,
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

    const outcome =
      body.type === "SETTLEMENT"
        ? await service.settle({
            cspAgentId,
            agentId: body.agentId,
            amount: body.amount,
            direction: body.direction,
            remarks: body.remarks,
            idempotencyKey,
            actor,
          })
        : await service.adjust({
            cspAgentId,
            cashLimit: body.cashLimit,
            cashInAccount: body.cashInAccount,
            cashLeftInBank: body.cashLeftInBank,
            agents: body.agents,
            remarks: body.remarks,
            idempotencyKey,
            actor,
          });

    return { ...outcome, view: await service.getView(cspAgentId) };
  });

  return res.status(result.replayed ? 200 : 201).json({
    success: true,
    message: result.replayed
      ? "Already recorded (same Idempotency-Key)."
      : body.type === "SETTLEMENT"
        ? "Settlement recorded."
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
