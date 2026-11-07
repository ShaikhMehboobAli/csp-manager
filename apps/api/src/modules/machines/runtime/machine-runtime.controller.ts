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
import MachineFamilyService from "../family/machine-family.service";
import AgentEmailOtpService from "../family/agent-email-otp.service";

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
      const { agentId, machineCode } = await this.machineAgent(tx, req.body, { write: true });

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
   * Whose cash a desktop call works on, inside a transaction: the agent
   * logged in to cash management on this PC (SBI kiosk login or email OTP;
   * any agent of the owner CSP's family), else the PC's own agent. Cash
   * management calls also need CASH_MANAGEMENT on the PC's plan (CSP plans;
   * BC plans aren't restricted), the same rule as the app. `write`: refused
   * while the agent has an open "Adjust" request (mandatory first).
   */
  private async machineAgent(
    tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
    body: Request["body"],
    options: { write?: boolean } = {},
  ) {
    const authenticated = await this.authenticated(tx, body);

    const { agentId } = await new MachineFamilyService(tx).cashAgentOf(authenticated);

    if (!agentId) {
      throw new ForbiddenError("No agent is currently assigned to this machine.");
    }

    const allowed = await new SubscriptionEntitlementService(tx).canViewCashManagement(
      authenticated.subscription,
    );

    if (!allowed) {
      throw new ForbiddenError("This plan doesn't include cash management.");
    }

    if (options.write) {
      await new CashService(tx).requireNoPendingAdjustment(agentId);
    }

    return { agentId, machineCode: authenticated.machine.machineCode, authenticated };
  }

  private async authenticated(tx: Parameters<Parameters<typeof withTransaction>[0]>[0], body: Request["body"]) {
    const authenticated = await new MachineAuthenticationService(tx).authenticate({
      machineCode: body.machineCode,
      apiKey: body.apiKey,
      fingerprint: body.fingerprint,
    });

    MachineRuntimeValidator.validateHeartbeat(authenticated);

    return authenticated;
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
      const { agentId, machineCode } = await this.machineAgent(tx, req.body, { write: true });

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
      const { agentId, machineCode } = await this.machineAgent(tx, req.body, { write: true });
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
      const { agentId, machineCode } = await this.machineAgent(tx, req.body, { write: true });

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
      const { agentId, machineCode } = await this.machineAgent(tx, req.body, { write: true });

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
      const { agentId, machineCode } = await this.machineAgent(tx, req.body, { write: true });
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
      const { agentId, machineCode } = await this.machineAgent(tx, req.body, { write: true });

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
      const { agentId, machineCode } = await this.machineAgent(tx, req.body, { write: true });

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

  // ---------------------------------------------------------------------------
  // Adjust requests and the one-step transfer
  // ---------------------------------------------------------------------------

  /** Open (or all) "Adjust" requests of the logged-in agent. */
  async getAdjustments(req: Request, res: Response) {
    const status = req.query.status === "ALL" ? undefined : "PENDING";

    const data = await withReadOnly(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);

      return new CashService(tx).listDrawerAdjustments({ agentIds: [agentId], status });
    });

    return res.status(200).json({ success: true, message: "Adjust requests fetched successfully.", data });
  }

  async completeAdjustment(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const { agentId, machineCode } = await this.machineAgent(tx, req.body);

      return new CashService(tx).completeDrawerAdjustment({
        agentId,
        adjustmentId: req.params.adjustmentId as string,
        drawer: req.body.drawer,
        notes: req.body.notes,
        machineCode,
      });
    });

    return res.status(200).json({ success: true, message: "Notes counted. Your drawer is up to date.", data });
  }

  /** Cash in hand ⇄ cash in account in one step (simple settlement). */
  async transferCash(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const { agentId, machineCode } = await this.machineAgent(tx, req.body, { write: true });

      return new CashService(tx).transfer({
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
      message:
        req.body.direction === "HAND_TO_ACCOUNT"
          ? "Moved to cash in account."
          : "Moved to cash in hand.",
      data,
    });
  }

  // ---------------------------------------------------------------------------
  // Cash management login (any agent of the family) and email verification
  // ---------------------------------------------------------------------------

  /** Who is logged in to cash management now, and who may log in (dropdown). */
  async getCashSession(req: Request, res: Response) {
    const data = await withReadOnly(async (tx) => {
      const authenticated = await this.authenticated(tx, req.body);
      const family = new MachineFamilyService(tx);
      const [current, accessAgents] = await Promise.all([
        family.cashAgentOf(authenticated),
        family.agents(authenticated),
      ]);

      return {
        cashAgent: accessAgents.find((agent) => agent.agentId === current.agentId) ?? null,
        loginMethod: current.method,
        accessAgents: accessAgents.map(({ email: _email, ...agent }) => agent),
      };
    });

    return res.status(200).json({ success: true, message: "Cash session fetched successfully.", data });
  }

  /** Fallback login: OTP to the agent's email (before / without the kiosk login). */
  async sendCashLoginOtp(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const authenticated = await this.authenticated(tx, req.body);
      const member = await new MachineFamilyService(tx).requireMember(authenticated, req.body.agentId);

      if (!member.email) {
        throw new BadRequestError(
          "This agent has no email. Ask the CSP to add it in the app, then verify it here.",
          "AGENT_EMAIL_MISSING",
        );
      }

      return new AgentEmailOtpService(tx).send({
        agentId: member.agentId,
        email: member.email,
        purpose: "CASH_LOGIN",
        machineId: authenticated.machine.id,
      });
    });

    return res.status(200).json({ success: true, message: "OTP sent to the agent's email.", data });
  }

  async verifyCashLoginOtp(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const authenticated = await this.authenticated(tx, req.body);
      const family = new MachineFamilyService(tx);
      const member = await family.requireMember(authenticated, req.body.agentId);

      const { email } = await new AgentEmailOtpService(tx).verify({
        agentId: member.agentId,
        purpose: "CASH_LOGIN",
        code: req.body.otp,
      });

      // A login OTP also proves the email.
      if (!member.emailVerified && email === member.email?.toLowerCase()) {
        await tx.agent.update({ where: { agentId: member.agentId }, data: { emailVerifiedAt: new Date() } });
      }

      await family.setCashAgent(authenticated.machine.id, member.agentId, "EMAIL_OTP");

      return {
        cashAgent: { ...member, email: undefined, emailVerified: true },
        loginMethod: "EMAIL_OTP",
        cash: await new CashService(tx).getMachineCash(member.agentId),
      };
    });

    return res.status(200).json({ success: true, message: "Logged in to cash management.", data });
  }

  async cashLogout(req: Request, res: Response) {
    await withTransaction(async (tx) => {
      const authenticated = await this.authenticated(tx, req.body);

      await new MachineFamilyService(tx).setCashAgent(authenticated.machine.id, null, null);
    });

    return res.status(200).json({
      success: true,
      message: "Logged out of cash management. The PC's own agent is shown again.",
    });
  }

  /** Verify (or set) the logged-in agent's email from the cash panel. */
  async sendEmailVerificationOtp(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const authenticated = await this.authenticated(tx, req.body);
      const family = new MachineFamilyService(tx);
      const { agentId } = await family.cashAgentOf(authenticated);
      const member = await family.requireMember(authenticated, agentId ?? "");
      const email = (req.body.email as string | undefined)?.trim().toLowerCase() ?? member.email;

      if (!email) {
        throw new BadRequestError("Enter the email to verify.", "AGENT_EMAIL_MISSING");
      }

      return new AgentEmailOtpService(tx).send({
        agentId: member.agentId,
        email,
        purpose: "EMAIL_VERIFICATION",
        machineId: authenticated.machine.id,
      });
    });

    return res.status(200).json({ success: true, message: "OTP sent to the email.", data });
  }

  async verifyEmail(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const authenticated = await this.authenticated(tx, req.body);
      const family = new MachineFamilyService(tx);
      const { agentId } = await family.cashAgentOf(authenticated);
      const member = await family.requireMember(authenticated, agentId ?? "");

      const { email } = await new AgentEmailOtpService(tx).verify({
        agentId: member.agentId,
        purpose: "EMAIL_VERIFICATION",
        code: req.body.otp,
      });

      await tx.agent.update({
        where: { agentId: member.agentId },
        data: { email, emailVerifiedAt: new Date() },
      });

      return { agentId: member.agentId, emailVerified: true };
    });

    return res.status(200).json({ success: true, message: "Email verified.", data });
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
