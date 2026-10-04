import { Router } from "express";

import * as MetricController from "./metric.controller";

import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();

router.get("/", authMiddleware, MetricController.getMetrics);

router.get("/:metricId", authMiddleware, MetricController.getMetric);

router.post("/", authMiddleware, MetricController.createMetric);

router.patch("/:metricId", authMiddleware, MetricController.updateMetric);

router.patch(
  "/:metricId/status",
  authMiddleware,
  MetricController.updateMetricStatus,
);

export default router;
