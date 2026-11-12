import { Request, Response } from "express";
import { z } from "zod";

import { withReadOnly, withTransaction } from "../../core/database/transaction";
import { fromIstCalendarDate } from "../../core/utils/ist";
import AgentScopeService from "../agents/service/agent-scope.service";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";

import TeamService from "./team.service";

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:30.")
  .nullable();

const todaySchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").optional(),
});

const settingsSchema = z
  .object({ workdayStart: time.optional(), workdayEnd: time.optional() })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to change." });

export const getToday = async (req: Request, res: Response) => {
  const query = todaySchema.parse(req.query);

  const data = await withReadOnly(async (tx) => {
    const subscription = await new SubscriptionResolver(tx).getEffectiveSubscription(req.user!.agentId);

    SubscriptionAccessValidator.validate(subscription);

    const scopeService = new AgentScopeService(tx);
    const scope = await scopeService.getAgentScope(req.user!);
    // agentId = a CSP → it and its KOs; a KO → that KO; none → your scope.
    const agentIds = query.agentId
      ? await scopeService.expandSelection(query.agentId, scope)
      : scope.length
        ? scope
        : [req.user!.agentId];

    return new TeamService(tx).today({
      agentIds,
      day: query.date ? fromIstCalendarDate(new Date(`${query.date}T00:00:00.000Z`)) : undefined,
    });
  });

  return res.status(200).json({ success: true, message: "Team fetched successfully.", data });
};

export const getSettings = async (req: Request, res: Response) => {
  const data = await withReadOnly((tx) => new TeamService(tx).getSettings(req.user!.agentId));

  return res.status(200).json({ success: true, message: "Team settings fetched successfully.", data });
};

export const updateSettings = async (req: Request, res: Response) => {
  const body = settingsSchema.parse(req.body);
  const data = await withTransaction((tx) => new TeamService(tx).updateSettings(req.user!.agentId, body));

  return res.status(200).json({ success: true, message: "Team settings updated.", data });
};
