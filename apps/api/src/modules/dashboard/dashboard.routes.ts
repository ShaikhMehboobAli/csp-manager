import { Router } from "express";

import DashboardController from "./dashboard.controller";

import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();

const controller = new DashboardController();

router.get("/summary", authMiddleware, controller.getSummary.bind(controller));

router.get(
  "/analytics",
  authMiddleware,
  controller.getAnalytics.bind(controller),
);

export default router;
