import { Request, Response } from "express";

import MachineHeartbeatService from "./machine-heartbeat.service";
import MachineEntitlementService from "./machine-entitlement.service";
import CspActivityService from "./csp-activity.service";
import prisma from "../../../config/prisma";
import { withReadOnly, withTransaction } from "../../../core/database/transaction";
import { ForbiddenError } from "../../../core/errors/ForbiddenError";
import { BadRequestError } from "../../../core/errors/BadRequestError";
import { fromIstCalendarDate, istDateKey } from "../../../core/utils/ist";
import { CashTaskCreator } from "../../../generated/prisma/enums";
import CashService from "../../cash/cash.service";
import CashSettlementService from "../../cash/cash-settlement.service";
import CashDeskService from "../../cash/cash-desk.service";
import CashDayService, { calendarDateOf } from "../../cash/cash-day.service";
import { CashTaskService } from "../../cash/cash-task.service";
import CashRepository from "../../cash/cash.repository";
import {
  machineDateQuerySchema,
  machineDaysQuerySchema,
  machineDuesQuerySchema,
  taskStatusQuerySchema,
} from "../../cash/cash.validation";
import SubscriptionEntitlementService from "../../subscriptions/subscription-entitlement.service";
import MachineAuthenticationService from "./machine-auth.service";
import MachineRuntimeValidator from "./machine-runtime-validator";

export default class MachineRuntimeController {
  async heartbeat(req: Request, res: Response) {
    const service = new MachineHeartbeatService(prisma);

    const result = await service.heartbeat(req.body);

    return res.status(200).json({
      success: true,
      message: "Heartbeat received successfully.",
      data: result,
    });
  }

  /**
   * The machine's agent asks its CSP to change its cash in hand / drawer.
   * Nothing changes until the CSP approves it in the app.
   */
  async createCashRequest(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const { agentId, machineCode } = await this.machineAgent(tx, req.body);

      return new CashService(tx).createRequest({
        agentId,
        cashInHand: req.body.cashInHand,
        drawer: req.body.drawer,
        reason: req.body.reason,
        requestedBy: machineCode,
      });
    });

    return res.status(201).json({
      success: true,
      message: "Cash change request sent to the CSP for approval.",
      data,
    });
  }

  /**
   * The machine's agent and its assigned-agent check, inside a transaction.
   * Cash management calls also need CASH_MANAGEMENT on the PC's plan (CSP
   * plans; BC plans aren't restricted), the same rule as the app.
   */
  private async machineAgent(tx: Parameters<Parameters<typeof withTransaction>[0]>[0], body: Request["body"]) {
    const authenticated = await new MachineAuthenticationService(tx).authenticate({
      machineCode: body.machineCode,
      apiKey: body.apiKey,
      fingerprint: body.fingerprint,
    });

    MachineRuntimeValidator.validateHeartbeat(authenticated);

    const agentId = authenticated.machine.currentAgentId;

    if (!agentId) {
      throw new ForbiddenError("No agent is currently assigned to this machine.");
    }

    const allowed = await new SubscriptionEntitlementService(tx).canViewCashManagement(
      authenticated.subscription,
    );

    if (!allowed) {
      throw new ForbiddenError("This plan doesn't include cash management.");
    }

    return { agentId, machineCode: authenticated.machine.machineCode };
  }

  private async agentCsp(tx: Parameters<Parameters<typeof withTransaction>[0]>[0], agentId: string) {
    const cspAgentId = await new CashRepository(tx).findPoolCspId(agentId);

    if (!cspAgentId) {
      throw new BadRequestError("This agent isn't part of a CSP.");
    }

    return cspAgentId;
  }

  /** The KO's cash screen: the day's cash (today unless `?date=`), history and open settlements. */
  async getCashToday(req: Request, res: Response) {
    const { date } = machineDateQuerySchema.parse(req.query);

    const data = await withReadOnly(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);

      return new CashSettlementService(tx).getAgentToday(
        agentId,
        date ? fromIstCalendarDate(calendarDateOf(date)) : undefined,
      );
    });

    return res.status(200).json({
      success: true,
      message: "Cash details fetched successfully.",
      data,
    });
  }

  async createSettlement(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const { agentId, machineCode } = await this.machineAgent(tx, req.body);

      return new CashSettlementService(tx).create({
        agentId,
        direction: req.body.direction,
        amount: req.body.amount,
        drawer: req.body.cashDenomination,
        remarks: req.body.remarks,
        machineCode,
      });
    });

    return res.status(201).json({
      success: true,
      message: "Settlement started. Approve it when the bank step is done.",
      data,
    });
  }

  async actOnSettlement(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const { agentId, machineCode } = await this.machineAgent(tx, req.body);
      const service = new CashSettlementService(tx);
      const input = {
        agentId,
        settlementId: req.params.settlementId as string,
        remarks: req.body.remarks,
        machineCode,
      };

      return req.body.action === "CANCEL"
        ? { cancelled: await service.cancel(input), next: null }
        : service.approve({
            ...input,
            drawer: req.body.cashDenomination,
            amount: req.body.amount,
          });
    });

    return res.status(200).json({
      success: true,
      message:
        "cancelled" in data
          ? "Settlement cancelled; the amount went back."
          : data.next
            ? "Step approved. The next step is open."
            : "Settlement completed.",
      data,
    });
  }

  // ---------------------------------------------------------------------------
  // Cash extras: labels, custom transactions, dues, exchange, day close,
  // history, tasks (all for the machine's agent)
  // ---------------------------------------------------------------------------

  async getCashLabels(req: Request, res: Response) {
    const data = await withReadOnly(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);

      return new CashDeskService(tx).listLabels(agentId);
    });

    return res.status(200).json({ success: true, message: "Labels fetched successfully.", data });
  }

  async createCustomTransaction(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const { agentId, machineCode } = await this.machineAgent(tx, req.body);

      return new CashDeskService(tx).createCustomTransaction({
        agentId,
        labelId: req.body.labelId,
        direction: req.body.direction,
        amount: req.body.amount,
        paidNow: req.body.paidNow,
        drawer: req.body.cashDenomination,
        note: req.body.note || undefined,
        machineCode,
      });
    });

    const message = data.due
      ? `Saved. ₹${data.due.amount} added to Balance due (${data.due.kind === "TO_COLLECT" ? "to collect" : "to give"}).`
      : "Saved.";

    return res.status(201).json({ success: true, message, data });
  }

  async getDues(req: Request, res: Response) {
    const { status } = machineDuesQuerySchema.parse(req.query);

    const data = await withReadOnly(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);

      return new CashDeskService(tx).listDues([agentId], status);
    });

    return res.status(200).json({ success: true, message: "Dues fetched successfully.", data });
  }

  async getDue(req: Request, res: Response) {
    const data = await withReadOnly(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);

      return new CashDeskService(tx).getDue(req.params.dueId as string, [agentId]);
    });

    return res.status(200).json({ success: true, message: "Due fetched successfully.", data });
  }

  async createDue(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const { agentId, machineCode } = await this.machineAgent(tx, req.body);

      return new CashDeskService(tx).createDue({
        agentId,
        kind: req.body.kind,
        amount: req.body.amount,
        note: req.body.note,
        receiptId: req.body.receiptId,
        cashSide: req.body.cashSide,
        drawer: req.body.cashDenomination,
        machineCode,
      });
    });

    // The due's fields stay at the top of `data` (compatible), plus `cash`.
    return res.status(201).json({
      success: true,
      message: data.message,
      data: { ...data.due, cash: data.cash },
    });
  }

  async actOnDue(req: Request, res: Response) {
    const result = await withTransaction(async (tx) => {
      const { agentId, machineCode } = await this.machineAgent(tx, req.body);
      const service = new CashDeskService(tx);
      const dueId = req.params.dueId as string;

      if (req.body.action === "CANCEL") {
        return { message: "Due cancelled.", data: await service.cancelDue({ agentId, dueId, machineCode }) };
      }

      const settled = await service.settleDue({
        agentId,
        dueId,
        amount: req.body.amount,
        drawer: req.body.cashDenomination,
        machineCode,
      });

      return {
        message: settled.rest > 0 ? `₹${settled.rest} is still due.` : "Due settled.",
        data: { due: settled.due, cash: settled.cash },
      };
    });

    return res.status(200).json({ success: true, ...result });
  }

  async createExchange(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const { agentId, machineCode } = await this.machineAgent(tx, req.body);

      return new CashDeskService(tx).createExchange({
        agentId,
        taken: req.body.taken,
        given: req.body.given,
        note: req.body.note || undefined,
        machineCode,
      });
    });

    return res.status(201).json({ success: true, message: "Cash exchange saved.", data });
  }

  async getExchanges(req: Request, res: Response) {
    const { date } = machineDateQuerySchema.parse(req.query);

    const data = await withReadOnly(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);

      return new CashDeskService(tx).listExchanges(
        agentId,
        date ? fromIstCalendarDate(calendarDateOf(date)) : new Date(),
      );
    });

    return res.status(200).json({ success: true, message: "Cash exchanges fetched successfully.", data });
  }

  async closeDay(req: Request, res: Response) {
    const result = await withTransaction(async (tx) => {
      const { agentId, machineCode } = await this.machineAgent(tx, req.body);

      return new CashDayService(tx).closeDay({
        agentId,
        countedCashInHand: req.body.countedCashInHand,
        countedDrawer: req.body.countedDrawer,
        machineCode,
      });
    });

    return res.status(201).json({ success: true, message: result.message, data: result.close });
  }

  async getDayClose(req: Request, res: Response) {
    const { date } = machineDateQuerySchema.parse(req.query);

    const data = await withReadOnly(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);
      return new CashDayService(tx).getDayClose(agentId, date ?? istDateKey(new Date()));
    });

    return res.status(200).json({ success: true, message: "Day close fetched successfully.", data });
  }

  async getCashDays(req: Request, res: Response) {
    // GET: range in the query; POST: in the body with the credentials.
    const range = machineDaysQuerySchema.parse(req.method === "POST" ? req.body : req.query);

    const data = await withReadOnly(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);

      return new CashDayService(tx).listDays(agentId, range);
    });

    return res.status(200).json({ success: true, message: "Cash days fetched successfully.", data });
  }

  async getTasks(req: Request, res: Response) {
    const { status } = taskStatusQuerySchema.parse(req.query);

    const data = await withReadOnly(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);

      const service = new CashTaskService(tx);
      const [tasks] = await Promise.all([service.list([agentId], status), service.markRead(agentId)]);

      return tasks;
    });

    return res.status(200).json({ success: true, message: "Tasks fetched successfully.", data });
  }

  async createTask(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const { agentId, machineCode } = await this.machineAgent(tx, req.body);

      return new CashTaskService(tx).create({
        cspAgentId: await this.agentCsp(tx, agentId),
        agentId,
        title: req.body.title,
        note: req.body.note || null,
        dueAt: req.body.dueAt ?? null,
        createdBy: CashTaskCreator.KO,
        createdById: machineCode,
      });
    });

    return res.status(201).json({ success: true, message: "Task added.", data });
  }

  async updateTask(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);

      return new CashTaskService(tx).update({
        taskId: req.params.taskId as string,
        agentIds: [agentId],
        by: CashTaskCreator.KO,
        change: {
          title: req.body.title,
          note: req.body.note === "" ? null : req.body.note,
          dueAt: req.body.dueAt,
          done: req.body.done,
        },
      });
    });

    return res.status(200).json({ success: true, message: "Task updated.", data });
  }

  async deleteTask(req: Request, res: Response) {
    await withTransaction(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);

      await new CashTaskService(tx).remove({
        taskId: req.params.taskId as string,
        agentIds: [agentId],
        by: CashTaskCreator.KO,
      });
    });

    return res.status(200).json({ success: true, message: "Task deleted." });
  }

  async getEntitlements(req: Request, res: Response) {
    const service = new MachineEntitlementService();

    const result = await service.getEntitlements(req.body);

    return res.status(200).json({
      success: true,
      message: "Machine entitlements fetched successfully.",
      data: result,
    });
  }

  async startActivity(req: Request, res: Response) {
    const result = await new CspActivityService().start(req.body);

    return res.status(201).json({
      success: true,
      message: "CSP activity session started.",
      data: result,
    });
  }

  async activityHeartbeat(req: Request, res: Response) {
    const result = await new CspActivityService().heartbeat(req.body);

    return res.status(200).json({
      success: true,
      message: result.restarted
        ? "Previous activity session timed out; a new session was started."
        : "Activity heartbeat received.",
      data: result,
    });
  }

  async stopActivity(req: Request, res: Response) {
    const result = await new CspActivityService().stop(req.body);

    return res.status(200).json({
      success: true,
      message: "CSP activity session stopped.",
      data: result,
    });
  }
}
