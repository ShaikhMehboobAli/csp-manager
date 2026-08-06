import { Request, Response } from "express";

import { withTransaction } from "../../core/database/transaction";

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

  async getReceipts(req: Request, res: Response) {
    const query = receiptListSchema.parse(req.query);

    return withTransaction(async (tx) => {
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(req.user!);

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
    return withTransaction(async (tx) => {
      const scopeService = new AgentScopeService(tx);

      const agentIds = await scopeService.getAgentScope(req.user!);

      const result = await this.service.getReceipt(
        req.params.receiptId,
        agentIds,
      );

      return res.json({
        success: true,

        message: "Receipt fetched successfully.",

        data: result,
      });
    });
  }
}
