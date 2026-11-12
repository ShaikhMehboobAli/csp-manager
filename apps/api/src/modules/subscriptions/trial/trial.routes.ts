import { Router } from "express";

import { authMiddleware } from "../../../core/middlewares/auth.middleware";
import { authorize } from "../../../core/middlewares/authorize.middleware";
import { validate } from "../../../core/middlewares/validate";
import { UserRole } from "../../../generated/prisma/enums";

import * as TrialController from "./trial.controller";
import {
  extendTrialSchema,
  listTrialsQuerySchema,
  listTrialUsagesQuerySchema,
  updateTrialSettingsSchema,
} from "./trial.validation";

/** /subscriptions/trial (CSP / BC owner). */
export const trialRoutes = Router();

trialRoutes.get("/", authMiddleware, authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN), TrialController.getTrial);

trialRoutes.post("/start", authMiddleware, authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN), TrialController.startTrial);

/** /admin (super admin): trial settings, trials, trial registry. */
export const trialAdminRoutes = Router();

trialAdminRoutes.use(["/trial-settings", "/trials", "/trial-usages"], authMiddleware, authorize(UserRole.SUPER_ADMIN));

trialAdminRoutes.get("/trial-settings", TrialController.getTrialSettings);

trialAdminRoutes.patch("/trial-settings", validate(updateTrialSettingsSchema), TrialController.updateTrialSettings);

trialAdminRoutes.get("/trials", validate(listTrialsQuerySchema, "query"), TrialController.listTrials);

trialAdminRoutes.patch("/trials/:subscriptionId", validate(extendTrialSchema), TrialController.extendTrial);

trialAdminRoutes.get("/trial-usages", validate(listTrialUsagesQuerySchema, "query"), TrialController.listTrialUsages);

trialAdminRoutes.delete("/trial-usages/:id", TrialController.deleteTrialUsage);
