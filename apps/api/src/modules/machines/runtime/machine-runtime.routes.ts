import { Router } from "express";

import MachineRuntimeController from "./machine-runtime.controller";

import {
  activityHeartbeatSchema,
  activityStartSchema,
  activityStopSchema,
  entitlementSchema,
  heartbeatSchema,
} from "./machine-runtime.validation";
import { asyncHandler } from "../../../core/utils/asyncHandler";
import { validate } from "../../../core/middlewares/validate";

const router = Router();

const controller = new MachineRuntimeController();

router.post(
  "/entitlements",
  validate(entitlementSchema),
  asyncHandler(controller.getEntitlements.bind(controller)),
);

router.post(
  "/heartbeat",
  validate(heartbeatSchema),
  asyncHandler(controller.heartbeat.bind(controller)),
);

/**
 * CSP activity (SBI login) session, driven by the desktop UI.
 */
router.post(
  "/activity/start",
  validate(activityStartSchema),
  asyncHandler(controller.startActivity.bind(controller)),
);

router.post(
  "/activity/heartbeat",
  validate(activityHeartbeatSchema),
  asyncHandler(controller.activityHeartbeat.bind(controller)),
);

router.post(
  "/activity/stop",
  validate(activityStopSchema),
  asyncHandler(controller.stopActivity.bind(controller)),
);

export default router;
