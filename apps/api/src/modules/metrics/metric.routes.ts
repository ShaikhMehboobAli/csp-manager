import { Router } from "express";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";

import * as MetricController from "./metric.controller";

import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();

router.get("/", authMiddleware, MetricController.getMetrics);

router.get("/:metricId", authMiddleware, MetricController.getMetric);

router.post(
  "/",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN),
  MetricController.createMetric,
);

router.patch(
  "/:metricId",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN),
  MetricController.updateMetric,
);

router.patch(
  "/:metricId/status",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN),
  MetricController.updateMetricStatus,
);

export default router;
