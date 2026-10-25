import { Request, Response } from "express";

import { withReadOnly } from "../../core/database/transaction";

import DashboardService from "./dashboard.service";
import {
  dashboardAnalyticsSchema,
  dashboardSummarySchema,
} from "./dashboard.validation";
import { UnauthorizedError } from "../../core/errors/UnauthorizedError";
import AgentScopeService from "../agents/service/agent-scope.service";
import { getTodayRange } from "./dashboard.helper";
import { endOfIstDay, istInstant } from "../../core/utils/ist";
import { AppError } from "../../core/errors/AppError";
import { DashboardCspDetailRepository } from "./repository/dashboard-csp-detail.repository";
import { BadRequestError } from "../../core/errors/BadRequestError";

export default class DashboardController {
  async getSummary(req: Request, res: Response) {
    return withReadOnly(async (tx) => {
      const service = new DashboardService(tx);

      console.log("dashboard controller---", req.user);
      /**
       * TODO:
       * We'll replace agentId with the logged-in user
       * once authentication middleware is integrated.
       */

      /**
       * TODO:
       * Once authentication is integrated:
       *
       * CSP:
       * agentId = req.user.agentId
       *
       * BC:
       * validate that the requested CSP belongs to the logged-in BC
       *
       * Super Admin:
       * can access any CSP
       */

      //   const result = await service.getSummary({
      //     agentId: req.query.agentId as string,

      //     from: req.query.from ? new Date(req.query.from as string) : undefined,

      //     to: req.query.to ? new Date(req.query.to as string) : undefined,
      //   });

      const currentUser = req.user;

      if (!currentUser) {
        throw new UnauthorizedError("Unauthorized.");
      }

      const query = dashboardSummarySchema.parse(req.query);

      const range =
        query.from || query.to
          ? {
              from: query.from,
              to: query.to,
            }
          : getTodayRange();

      //   const result = await service.getSummary({
      //     ...query,

      //     agentId: currentUser.agentId,
      //   });

      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(req.user!);
      scopeService.ensureAgentAccessible(query.agentId, agentIds);

      console.log("Dashboard Scope:", {
        role: req.user!.role,
        currentAgent: req.user!.agentId,
        agentIds,
      });

      const result = await service.getSummary({
        ...query,

        ...range,

        currentAgentId: req.user!.agentId,

        agentIds,
      });

      return res.status(200).json({
        success: true,

        message: "Dashboard summary fetched successfully.",

        data: result,
      });
    });
  }

  async getAnalytics(req: Request, res: Response) {
    return withReadOnly(async (tx) => {
      const service = new DashboardService(tx);

      const query = dashboardAnalyticsSchema.parse(req.query);

      const range =
        query.from || query.to
          ? {
              from: query.from,
              to: query.to,
            }
          : getTodayRange();

      //   const result = await service.getAnalytics({
      //     ...query,

      //     agentId: req.user!.agentId,
      //   });

      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(req.user!);
      scopeService.ensureAgentAccessible(query.agentId, agentIds);

      const result = await service.getAnalytics({
        ...query,

        ...range,

        currentAgentId: req.user!.agentId,

        agentIds,
      });

      return res.json({
        success: true,

        message: "Dashboard analytics fetched successfully.",

        data: result,
      });
    });
  }

  async getCspDetail(req: Request, res: Response) {
    return withReadOnly(async (tx) => {
      const currentUser = req.user!;

      if (!currentUser) {
        throw new UnauthorizedError("Unauthorized.");
      }

      const agentIdParam = req.params.agentId;

      if (typeof agentIdParam !== "string") {
        throw new Error("Invalid CSP agentId.");
      }

      const agentId = agentIdParam;

      const section = req.query.section as string;
      const month = req.query.month as string;

      if (section !== "socialSecurity" && section !== "transaction") {
        throw new BadRequestError(
          "section must be socialSecurity or transaction.",
        );
      }

      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        throw new BadRequestError("month must be in YYYY-MM format.");
      }

      const [year, monthNumber] = month.split("-").map(Number);

      // const from = new Date(Date.UTC(year, monthNumber - 1, 1));

      // const to = new Date(Date.UTC(year, monthNumber, 0, 23, 59, 59, 999));

      // The month and "today" are IST calendar days.
      const from = istInstant(year, monthNumber - 1, 1);

      const monthEnd = istInstant(year, monthNumber, 0, 23, 59, 59, 999);

      const today = endOfIstDay(new Date());

      if (from > today) {
        throw new BadRequestError("Future month is not allowed.");
      }

      const to = monthEnd < today ? monthEnd : today;

      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(currentUser);

      scopeService.ensureAgentAccessible(agentId, agentIds);

      const service = new DashboardService(tx);

      const result = await service.getCspDetail({
        currentAgentId: currentUser.agentId,
        agentId,
        from,
        to,
        section: section as "socialSecurity" | "transaction",
      });

      return res.status(200).json({
        success: true,
        message: "CSP detail fetched successfully.",
        data: result,
      });
    });
  }
}
