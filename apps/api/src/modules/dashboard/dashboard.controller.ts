import { Request, Response } from "express";

import { withTransaction } from "../../core/database/transaction";

import DashboardService from "./dashboard.service";
import {
  dashboardAnalyticsSchema,
  dashboardSummarySchema,
} from "./dashboard.validation";
import { UnauthorizedError } from "../../core/errors/UnauthorizedError";

export default class DashboardController {
  async getSummary(req: Request, res: Response) {
    return withTransaction(async (tx) => {
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

      const result = await service.getSummary({
        ...query,

        agentId: currentUser.agentId,
      });

      return res.status(200).json({
        success: true,

        message: "Dashboard summary fetched successfully.",

        data: result,
      });
    });
  }

  async getAnalytics(req: Request, res: Response) {
    return withTransaction(async (tx) => {
      const service = new DashboardService(tx);

      const query = dashboardAnalyticsSchema.parse(req.query);

      const result = await service.getAnalytics({
        ...query,

        agentId: req.user!.agentId,
      });

      return res.json({
        success: true,

        message: "Dashboard analytics fetched successfully.",

        data: result,
      });
    });
  }
}
