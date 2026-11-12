import { Router } from "express";

import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { validate } from "../../core/middlewares/validate";
import { UserRole } from "../../generated/prisma/enums";

import * as AppConfigController from "./app-config.controller";
import { updateAppConfigSchema } from "./app-config.validation";

/** Public: `GET /app/config?platform=&version=`. */
export const appConfigRoutes = Router();

appConfigRoutes.get("/config", AppConfigController.getAppConfig);

/** Super admin: `GET` / `PATCH /admin/app-config`. */
export const appConfigAdminRoutes = Router();

appConfigAdminRoutes.get(
  "/app-config",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN),
  AppConfigController.getAdminAppConfig,
);

appConfigAdminRoutes.patch(
  "/app-config",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN),
  validate(updateAppConfigSchema),
  AppConfigController.updateAdminAppConfig,
);
