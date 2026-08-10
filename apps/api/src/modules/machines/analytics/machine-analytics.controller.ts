import { Request, Response } from "express";

import prisma from "../../../config/prisma";

import MachineAnalyticsService from "./machine-analytics.service";
import { machineAnalyticsQuerySchema } from "./machine-analytics.validation";

export default class MachineAnalyticsController {
  async getAnalytics(req: Request, res: Response) {
    const service = new MachineAnalyticsService(prisma);

    const query = machineAnalyticsQuerySchema.parse(req.query);

    const result = await service.getAnalytics(
      req.params.machineId as string,
      query,
      req.user!,
    );

    return res.status(200).json({
      success: true,
      message: "Machine analytics fetched successfully.",
      data: result,
    });
  }
}
