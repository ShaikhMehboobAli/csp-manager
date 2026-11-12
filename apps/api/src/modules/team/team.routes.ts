import { Router } from "express";

import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";

import * as TeamController from "./team.controller";

/** Team today (CSP, BC, super admin) and the CSP's working day. Mounted at /team. */
const router = Router();

router.use(authMiddleware);

router.get("/today", authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN, UserRole.SUPER_ADMIN), TeamController.getToday);
router.get("/settings", authorize(UserRole.CSP_ADMIN), TeamController.getSettings);
router.patch("/settings", authorize(UserRole.CSP_ADMIN), TeamController.updateSettings);

export default router;
