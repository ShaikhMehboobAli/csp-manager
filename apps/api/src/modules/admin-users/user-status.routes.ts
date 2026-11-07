import { Router } from "express";

import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { validate } from "../../core/middlewares/validate";
import { UserRole } from "../../generated/prisma/enums";

import * as UserStatusController from "./user-status.controller";
import { updateUserStatusSchema } from "./user-status.validation";

/** Super admin: block / suspend / reactivate login accounts. Mounted at /admin/users. */
const router = Router();

router.use(authMiddleware, authorize(UserRole.SUPER_ADMIN));

router.get("/:agentId/status", UserStatusController.getStatus);

router.patch("/:agentId/status", validate(updateUserStatusSchema), UserStatusController.updateStatus);

export default router;
