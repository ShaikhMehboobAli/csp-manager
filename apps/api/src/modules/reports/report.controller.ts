import { Request, Response } from "express";

import { withTransaction } from "../../core/database/transaction";

import AgentScopeService from "../agents/service/agent-scope.service";

import ReportService from "./report.service";

import { reportSummarySchema } from "./report.validation";

export default class ReportController {
  private readonly service = new ReportService();

  async getSummary(req: Request, res: Response) {
    const query = reportSummarySchema.parse(req.query);

    return withTransaction(async (tx) => {
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(req.user!);
      scopeService.ensureAgentAccessible(query.agentId, agentIds);

      const result = await this.service.getSummary({
        ...query,

        currentAgentId: req.user!.agentId,

        agentIds,
      });

      return res.json({
        success: true,

        message: "Report fetched successfully.",

        data: result,
      });
    });
  }

  async export(req: Request, res: Response) {
    const query = reportSummarySchema.parse(req.query);

    return withTransaction(async (tx) => {
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(req.user!);
      scopeService.ensureAgentAccessible(query.agentId, agentIds);

      const workbook = await this.service.exportReport({
        ...query,

        currentAgentId: req.user!.agentId,

        agentIds,
      });

      const fileName = `bc-settlement-report-${Date.now()}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );

      return res.send(Buffer.from(workbook));
    });
  }
}
