import { Request, Response } from "express";

import MachineHeartbeatService from "./machine-heartbeat.service";
import MachineEntitlementService from "./machine-entitlement.service";
import CspActivityService from "./csp-activity.service";
import prisma from "../../../config/prisma";
import { withTransaction } from "../../../core/database/transaction";
import { ForbiddenError } from "../../../core/errors/ForbiddenError";
import CashService from "../../cash/cash.service";
import CashSettlementService from "../../cash/cash-settlement.service";
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
      const authenticated = await new MachineAuthenticationService(tx).authenticate({
        machineCode: req.body.machineCode,
        apiKey: req.body.apiKey,
        fingerprint: req.body.fingerprint,
      });

      MachineRuntimeValidator.validateHeartbeat(authenticated);

      const agentId = authenticated.machine.currentAgentId;

      if (!agentId) {
        throw new ForbiddenError("No agent is currently assigned to this machine.");
      }

      return new CashService(tx).createRequest({
        agentId,
        cashInHand: req.body.cashInHand,
        drawer: req.body.drawer,
        reason: req.body.reason,
        requestedBy: authenticated.machine.machineCode,
      });
    });

    return res.status(201).json({
      success: true,
      message: "Cash change request sent to the CSP for approval.",
      data,
    });
  }

  /** The machine's agent and its assigned-agent check, inside a transaction. */
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

    return { agentId, machineCode: authenticated.machine.machineCode };
  }

  /** The KO's cash screen: today's cash, history and open settlements. */
  async getCashToday(req: Request, res: Response) {
    const data = await withTransaction(async (tx) => {
      const { agentId } = await this.machineAgent(tx, req.body);
      const agent = await tx.agent.findUnique({ where: { agentId }, select: { name: true } });

      return new CashSettlementService(tx).getAgentToday(agentId, agent?.name ?? null);
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
