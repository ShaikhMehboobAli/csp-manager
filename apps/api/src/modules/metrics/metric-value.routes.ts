import { Router } from "express";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";

import * as MetricValueController from "./metric-value.controller";

import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();

router.get("/", authMiddleware, MetricValueController.getMetricValues);

router.post(
  "/",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN, UserRole.BC_ADMIN),
  MetricValueController.createMetricValue,
);

router.patch(
  "/:valueId",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN, UserRole.BC_ADMIN),
  MetricValueController.updateMetricValue,
);

export default router;
