import { Router } from "express";

import MachineRuntimeController from "./machine-runtime.controller";

import {
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

export default router;
