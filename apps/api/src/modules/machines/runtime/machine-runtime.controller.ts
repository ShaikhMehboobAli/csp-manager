import { Request, Response } from "express";

import MachineHeartbeatService from "./machine-heartbeat.service";
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
}
