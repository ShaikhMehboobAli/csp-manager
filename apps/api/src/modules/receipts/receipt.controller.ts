import ReceiptFieldsSettingsService, {
  RECEIPT_FIELDS,
  RECEIPT_FIELD_NAMES,
} from "../settings/receipt-fields-settings.service";
import { Request, Response } from "express";

import { withReadOnly } from "../../core/database/transaction";

import AgentScopeService from "../agents/service/agent-scope.service";

import ReceiptService from "./receipt.service";

import { ReceiptListQuery, receiptListSchema } from "./receipt.validation";
import { ReceiptParams } from "./receipt.dto";
import { CurrentUser } from "../../core/types/auth.types";
import { resolveDateRange } from "../reports/helper/report.helper";

/**
 * Agents and dates for the receipt list, stats and export. `agentIds` picks
 * agents inside the caller's scope (each is checked); without it the whole
 * scope is used. `period` sets the dates unless from/to are given.
 */
async function resolveReceiptFilter(
  scopeService: AgentScopeService,
  user: CurrentUser,
  query: ReceiptListQuery,
) {
  const scope = await scopeService.getAgentScope(user);

  scopeService.ensureAgentAccessible(query.agentId, scope);

  if (query.agentIds) {
    scopeService.ensureAgentsAccessible(query.agentIds, scope);
  }

  return {
    agentIds: query.agentIds ?? scope,
    ...(query.period
      ? resolveDateRange(query.period, query.from, query.to)
      : { from: query.from, to: query.to }),
  };
}

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

      const { agentIds, ...dates } = await resolveReceiptFilter(
        scopeService,
        req.user!,
        query,
      );

      const result = await this.service.getReceipts({
        ...query,

        ...dates,

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

      const scope = await scopeService.getAgentScope(req.user!);

      // receiptId is unique per agent: ?agentId= picks the agent's receipt.
      const agentId = typeof req.query.agentId === "string" ? req.query.agentId.trim() : "";

      if (agentId) {
        scopeService.ensureAgentAccessible(agentId, scope);
      }

      const result = await this.service.getReceipt(
        req.params.receiptId,
        agentId ? [agentId] : scope,
        req.user!.agentId,
      );

      return res.json({
        success: true,

        message: "Receipt fetched successfully.",

        data: result,
      });
    });
  }

  async getFields(_req: Request, res: Response) {
    const allowed = await new ReceiptFieldsSettingsService().getFields();

    return res.json({
      success: true,
      message: "Receipt fields fetched successfully.",
      data: RECEIPT_FIELD_NAMES.map((field) => ({
        field,
        label: RECEIPT_FIELDS[field].label,
        personal: RECEIPT_FIELDS[field].personal,
        allowed: allowed[field],
      })),
    });
  }

  async getStats(req: Request, res: Response) {
    const query = receiptListSchema.parse(req.query);

    return withReadOnly(async (tx) => {
      const scopeService = new AgentScopeService(tx);

      const { agentIds, ...dates } = await resolveReceiptFilter(
        scopeService,
        req.user!,
        query,
      );

      const result = await this.service.getStats({
        ...query,

        ...dates,

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

      const { agentIds, ...dates } = await resolveReceiptFilter(
        scopeService,
        req.user!,
        query,
      );

      const workbook = await this.service.export({
        ...query,

        ...dates,

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
