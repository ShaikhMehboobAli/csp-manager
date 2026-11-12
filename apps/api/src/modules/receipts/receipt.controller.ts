import ReceiptFieldsSettingsService, {
  RECEIPT_FIELDS,
  RECEIPT_FIELD_NAMES,
} from "../settings/receipt-fields-settings.service";
import { Request, Response } from "express";

import { withReadOnly, withTransaction } from "../../core/database/transaction";
import { PrismaDb } from "../../core/database/prisma.types";

import AgentScopeService from "../agents/service/agent-scope.service";

import ReceiptService from "./receipt.service";
import ReceiptSlipService from "./receipt-slip.service";
import ReceiptReportService from "./receipt-report.service";
import { buildReceiptPdf } from "./receipt-pdf.helper";

import {
  ReceiptListQuery,
  receiptListSchema,
  receiptReportListSchema,
  receiptReportSchema,
} from "./receipt.validation";
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
      const { detail: result } = await this.loadAccessible(tx, req);

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
        // Defaults are always on; the rest only when the super admin selects them.
        fixed: RECEIPT_FIELDS[field].fixed,
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

  /** Short-lived download link of the receipt's slip image. */
  async getSlip(req: Request<ReceiptParams>, res: Response) {
    const { receipt } = await withReadOnly((tx) => this.loadAccessible(tx, req));
    const data = await new ReceiptSlipService().downloadUrl(receipt);

    return res.json({ success: true, message: "Slip link created.", data });
  }

  async getPdf(req: Request<ReceiptParams>, res: Response) {
    const { detail } = await withReadOnly((tx) => this.loadAccessible(tx, req));
    const pdf = await buildReceiptPdf(detail);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="receipt-${detail.receiptId.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf"`,
    );

    return res.send(pdf);
  }

  async report(req: Request<ReceiptParams>, res: Response) {
    const body = receiptReportSchema.parse(req.body);

    const data = await withTransaction(async (tx) => {
      const { receipt, detail } = await this.loadAccessible(tx, req);

      return new ReceiptReportService(tx).create({
        receipt,
        snapshot: detail,
        reason: body.reason,
        details: body.details,
        reportedBy: req.user!.agentId,
      });
    });

    return res.status(201).json({
      success: true,
      message: "Problem reported. The support team will look into it.",
      data,
    });
  }

  async getReports(req: Request, res: Response) {
    const query = receiptReportListSchema.parse(req.query);

    const data = await withReadOnly(async (tx) => {
      const scope = await new AgentScopeService(tx).getAgentScope(req.user!);

      return new ReceiptReportService(tx).listForAgents({
        agentIds: scope.length ? scope : [req.user!.agentId],
        reportedBy: req.user!.agentId,
        status: query.status,
      });
    });

    return res.json({ success: true, message: "Problem reports fetched successfully.", data });
  }

  async uploadSlipUrl(req: Request, res: Response) {
    const data = await new ReceiptSlipService().createUploadUrl(req.body);

    return res.status(200).json({ success: true, message: "Slip upload URL created.", data });
  }

  async confirmSlip(req: Request, res: Response) {
    const data = await new ReceiptSlipService().confirm(req.body);

    return res.status(200).json({ success: true, message: "Slip saved.", data });
  }

  /** The receipt in the caller's scope; ?agentId= picks the agent's receipt (receiptId is unique per agent). */
  private async loadAccessible(tx: PrismaDb, req: Request<ReceiptParams>) {
    const scopeService = new AgentScopeService(tx);

    const scope = await scopeService.getAgentScope(req.user!);

    const agentId = typeof req.query.agentId === "string" ? req.query.agentId.trim() : "";

    if (agentId) {
      scopeService.ensureAgentAccessible(agentId, scope);
    }

    return this.service.loadReceipt(tx, req.params.receiptId, agentId ? [agentId] : scope, req.user!.agentId);
  }
}
