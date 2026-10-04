import { Request, Response } from "express";

// import { withTransaction } from "../../core/database/with-transaction";
import { UnauthorizedError } from "../../core/errors/UnauthorizedError";
import { BadRequestError } from "../../core/errors/BadRequestError";
// import { AgentScopeService } from "../agents/services/agent-scope.service";

import CspVisitService from "./csp-visit.service";
import { createCspVisitSchema } from "./validators/create-csp-visit.schema";
import { withTransaction } from "../../core/database/transaction";
import AgentScopeService from "../agents/service/agent-scope.service";

export default class CspVisitController {
  async createVisit(req: Request, res: Response) {
    return withTransaction(async (tx) => {
      const currentUser = req.user!;

      if (!currentUser) {
        throw new UnauthorizedError("Unauthorized.");
      }

      const input = createCspVisitSchema.parse(req.body);

      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(currentUser);

      scopeService.ensureAgentAccessible(input.cspAgentId, agentIds);

      const service = new CspVisitService(tx);

      const result = await service.createVisit(
        input,
        currentUser.agentId,
        agentIds,
      );

      return res.status(201).json({
        success: true,
        message: "CSP visit created successfully.",
        data: result,
      });
    });
  }

  async getVisit(req: Request, res: Response) {
    return withTransaction(async (tx) => {
      const currentUser = req.user!;

      if (!currentUser) {
        throw new UnauthorizedError("Unauthorized.");
      }

      const idParam = req.params.id;

      if (typeof idParam !== "string") {
        throw new BadRequestError("Visit ID is required.");
      }

      const service = new CspVisitService(tx);

      const result = await service.getVisit(idParam);

      return res.status(200).json({
        success: true,
        message: "CSP visit fetched successfully.",
        data: result,
      });
    });
  }

  async getCspVisits(req: Request, res: Response) {
    return withTransaction(async (tx) => {
      const currentUser = req.user!;

      const cspAgentIdParam = req.params.cspAgentId;

      if (typeof cspAgentIdParam !== "string") {
        throw new BadRequestError("CSP agent ID is required.");
      }

      const fromParam = req.query.from;
      const toParam = req.query.to;

      const from =
        typeof fromParam === "string" ? new Date(fromParam) : undefined;

      const to = typeof toParam === "string" ? new Date(toParam) : undefined;

      if (from && Number.isNaN(from.getTime())) {
        throw new BadRequestError("Invalid from date.");
      }

      if (to && Number.isNaN(to.getTime())) {
        throw new BadRequestError("Invalid to date.");
      }

      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(currentUser);

      scopeService.ensureAgentAccessible(cspAgentIdParam, agentIds);

      const service = new CspVisitService(tx);

      const result = await service.getCspVisits(cspAgentIdParam, from, to);

      return res.status(200).json({
        success: true,
        message: "CSP visits fetched successfully.",
        data: result,
      });
    });
  }
}
