import { Request, Response } from "express";

import MachineHeartbeatService from "./machine-heartbeat.service";
import MachineEntitlementService from "./machine-entitlement.service";
import CspActivityService from "./csp-activity.service";
import prisma from "../../../config/prisma";

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
