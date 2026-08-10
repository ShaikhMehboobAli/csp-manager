import { Router } from "express";

import MachineAnalyticsController from "./machine-analytics.controller";
import { authMiddleware } from "../../../core/middlewares/auth.middleware";
import { asyncHandler } from "../../../core/utils/asyncHandler";

const router = Router();

const controller = new MachineAnalyticsController();

router.get(
  "/:machineId/analytics",
  authMiddleware,
  asyncHandler(controller.getAnalytics.bind(controller)),
);

export default router;
