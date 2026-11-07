import { Router } from "express";

import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";

import * as ReceiptReportController from "./receipt-report.controller";

/** Super admin: receipt problem reports. Mounted at /admin/receipt-reports. */
const router = Router();

router.use(authMiddleware, authorize(UserRole.SUPER_ADMIN));

router.get("/", ReceiptReportController.adminList);
router.patch("/:reportId", ReceiptReportController.adminResolve);

export default router;
