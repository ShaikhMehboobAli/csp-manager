import { Router } from "express";

import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { validate } from "../../core/middlewares/validate";
import { UserRole } from "../../generated/prisma/enums";

import * as DesktopSettingsController from "./desktop-settings.controller";
import {
  updateDesktopSettingsSchema,
  updateMachineDesktopControlsSchema,
  updateReceiptFieldsSchema,
  updateReceiptRetentionSchema,
} from "./desktop-settings.validation";

const router = Router();

// Super admin only for now.
router.use(authMiddleware, authorize(UserRole.SUPER_ADMIN));

router.get("/desktop-settings", DesktopSettingsController.getDesktopSettings);

router.patch(
  "/desktop-settings",
  validate(updateDesktopSettingsSchema),
  DesktopSettingsController.updateDesktopSettings,
);

router.get(
  "/machines/:machineCode/desktop-controls",
  DesktopSettingsController.getMachineDesktopControls,
);

router.patch(
  "/machines/:machineCode/desktop-controls",
  validate(updateMachineDesktopControlsSchema),
  DesktopSettingsController.updateMachineDesktopControls,
);

router.get(
  "/receipt-retention",
  DesktopSettingsController.getReceiptRetention,
);

router.patch(
  "/receipt-retention",
  validate(updateReceiptRetentionSchema),
  DesktopSettingsController.updateReceiptRetention,
);

// Which optional receipt fields the desktop may send (never Aadhaar).
router.get("/receipt-fields", DesktopSettingsController.getReceiptFields);

router.patch(
  "/receipt-fields",
  validate(updateReceiptFieldsSchema),
  DesktopSettingsController.updateReceiptFields,
);

export default router;
