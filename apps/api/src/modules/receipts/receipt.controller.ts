import { Request, Response } from "express";

import { withReadOnly } from "../../core/database/transaction";

import AgentScopeService from "../agents/service/agent-scope.service";

import ReceiptService from "./receipt.service";

import { receiptListSchema } from "./receipt.validation";
import { ReceiptParams } from "./receipt.dto";

export default class ReceiptController {
  private readonly service = new ReceiptService();

  async upload(req: Request, res: Response) {
    const result = await this.service.upload(req.body);

    return res.status(201).json(result);
  }

  async uploadCounts(req: Request, res: Response) {
    const result = await this.service.uploadCounts(req.body);

    return res.status(201).json(result);
  }

  async getReceipts(req: Request, res: Response) {
    const query = receiptListSchema.parse(req.query);

    return withReadOnly(async (tx) => {
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(req.user!);

      scopeService.ensureAgentAccessible(query.agentId, agentIds);

      const result = await this.service.getReceipts({
        ...query,

        currentAgentId: req.user!.agentId,

        agentIds,
      });

      return res.json({
        success: true,

        message: "Receipts fetched successfully.",

        data: result,
      });
    });
  }

  async getReceipt(req: Request<ReceiptParams>, res: Response) {
    return withReadOnly(async (tx) => {
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(req.user!);

      const result = await this.service.getReceipt(
        req.params.receiptId,
        agentIds,
        req.user!.agentId,
      );

      return res.json({
        success: true,

        message: "Receipt fetched successfully.",

        data: result,
      });
    });
  }

  async getStats(req: Request, res: Response) {
    const query = receiptListSchema.parse(req.query);

    return withReadOnly(async (tx) => {
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(req.user!);

      scopeService.ensureAgentAccessible(query.agentId, agentIds);

      const result = await this.service.getStats({
        ...query,

        currentAgentId: req.user!.agentId,

        agentIds,
      });

      return res.json({
        success: true,

        message: "Receipt statistics fetched successfully.",

        data: result,
      });
    });
  }

  async export(req: Request, res: Response) {
    const query = receiptListSchema.parse(req.query);

    return withReadOnly(async (tx) => {
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(req.user!);
      scopeService.ensureAgentAccessible(query.agentId, agentIds);

      const workbook = await this.service.export({
        ...query,

        currentAgentId: req.user!.agentId,

        agentIds,
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="receipts-${Date.now()}.xlsx"`,
      );

      return res.send(Buffer.from(workbook));
    });
  }
}
