import { Request, Response } from "express";

import { withReadOnly, withTransaction } from "../../core/database/transaction";
import { PrismaDb } from "../../core/database/prisma.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { CurrentUser } from "../../core/types/auth.types";
import { CommissionRateType, CommissionScope, UserRole } from "../../generated/prisma/enums";
import AgentScopeService from "../agents/service/agent-scope.service";
import CashRepository from "../cash/cash.repository";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";

import CommissionService from "./commission.service";
import {
  commissionMonthsSchema,
  commissionRatesSchema,
  commissionSummarySchema,
  rateHistoryQuerySchema,
  rateScopeQuerySchema,
  setRateSchema,
  updateServiceSchema,
} from "./commission.validation";

/**
 * Whose commission: like the dashboard. No agentId = the whole scope; a CSP =
 * the CSP and its KOs (all of it earned by the CSP); a KO = what that KO
 * generated. Also the CSP whose rates apply (null for a BC's whole scope).
 */
async function selection(db: PrismaDb, user: CurrentUser, agentId?: string) {
  const subscription = await new SubscriptionResolver(db).getEffectiveSubscription(user.agentId);

  SubscriptionAccessValidator.validate(subscription);

  const scopeService = new AgentScopeService(db);
  const scope = await scopeService.getAgentScope(user);
  const repository = new CashRepository(db);

  if (!agentId) {
    return {
      agentIds: scope.length ? scope : [user.agentId],
      rateCspAgentId: user.role === UserRole.CSP_ADMIN ? user.agentId : null,
    };
  }

  const agentIds = await scopeService.expandSelection(agentId, scope);

  return { agentIds, rateCspAgentId: await repository.findPoolCspId(agentId) };
}

export const getSummary = async (req: Request, res: Response) => {
  const query = commissionSummarySchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const { agentIds, rateCspAgentId } = await selection(tx, req.user!, query.agentId);

    return new CommissionService(tx).summary({
      agentIds,
      period: query.period,
      month: query.month,
      rateCspAgentId,
    });
  });

  return res.status(200).json({ success: true, message: "Commission fetched successfully.", data });
};

export const getMonths = async (req: Request, res: Response) => {
  const query = commissionMonthsSchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const { agentIds } = await selection(tx, req.user!, query.agentId);

    return new CommissionService(tx).months(agentIds, query.count);
  });

  return res.status(200).json({ success: true, message: "Monthly commission fetched successfully.", data });
};

export const getRates = async (req: Request, res: Response) => {
  const query = commissionRatesSchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const { rateCspAgentId } = await selection(tx, req.user!, query.agentId);

    if (!rateCspAgentId) {
      throw new BadRequestError("agentId is required (a CSP or one of its KOs).");
    }

    return new CommissionService(tx).liveRates(rateCspAgentId);
  });

  return res.status(200).json({ success: true, message: "Commission rates fetched successfully.", data });
};

// -----------------------------------------------------------------------------
// Super admin
// -----------------------------------------------------------------------------

export const adminListServices = async (_req: Request, res: Response) => {
  const data = await withReadOnly((tx) => new CommissionService(tx).listServices());

  return res.status(200).json({ success: true, message: "Services fetched successfully.", data });
};

export const adminUpdateService = async (req: Request, res: Response) => {
  const body = updateServiceSchema.parse(req.body);
  const data = await withTransaction((tx) =>
    new CommissionService(tx).updateService(req.params.code as string, body),
  );

  return res.status(200).json({ success: true, message: "Service updated.", data });
};

export const adminListRates = async (req: Request, res: Response) => {
  const query = rateScopeQuerySchema.parse(req.query);
  const data = await withReadOnly((tx) =>
    new CommissionService(tx).ratesForScope(query.scope as CommissionScope, query.scope === "DEFAULT" ? "" : query.scopeId),
  );

  return res.status(200).json({ success: true, message: "Rates fetched successfully.", data });
};

export const adminRateHistory = async (req: Request, res: Response) => {
  const query = rateHistoryQuerySchema.parse(req.query);
  const data = await withReadOnly((tx) =>
    new CommissionService(tx).history({
      serviceCode: query.serviceCode,
      scope: query.scope as CommissionScope | undefined,
      scopeId: query.scopeId,
    }),
  );

  return res.status(200).json({ success: true, message: "Rate history fetched successfully.", data });
};

export const adminSetRate = async (req: Request, res: Response) => {
  const body = setRateSchema.parse(req.body);
  const data = await withTransaction((tx) =>
    new CommissionService(tx).setRate({
      ...body,
      scope: body.scope as CommissionScope,
      type: body.type as CommissionRateType,
      createdBy: req.user!.userId,
    }),
  );

  return res.status(201).json({ success: true, message: "Rate saved.", data });
};

export const adminDeleteRate = async (req: Request, res: Response) => {
  await withTransaction((tx) => new CommissionService(tx).deleteRate(req.params.rateId as string));

  return res.status(200).json({ success: true, message: "Rate deleted." });
};
