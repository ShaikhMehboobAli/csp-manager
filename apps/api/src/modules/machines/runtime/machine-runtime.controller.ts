import { Request, Response } from "express";

import MachineHeartbeatService from "./machine-heartbeat.service";
import MachineEntitlementService from "./machine-entitlement.service";
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
}
