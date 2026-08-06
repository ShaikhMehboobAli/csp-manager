import { Router } from "express";

import ReportController from "./report.controller";
import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();

const controller = new ReportController();

router.get("/summary", authMiddleware, controller.getSummary.bind(controller));

router.get("/export", authMiddleware, controller.export.bind(controller));

export default router;
