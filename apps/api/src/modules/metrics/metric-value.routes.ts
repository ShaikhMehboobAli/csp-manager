import { Router } from "express";

import * as MetricValueController from "./metric-value.controller";

import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();

router.get("/", authMiddleware, MetricValueController.getMetricValues);

router.post("/", authMiddleware, MetricValueController.createMetricValue);

router.patch(
  "/:valueId",
  authMiddleware,
  MetricValueController.updateMetricValue,
);

export default router;
