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
import {
  machineCashRequestSchema,
  machineCashSchema,
  machineSettlementActionSchema,
  machineSettlementSchema,
} from "../../cash/cash.validation";
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

/**
 * Cash management: the agent's cash comes in every heartbeat (`cash`); a
 * change to it needs the CSP's approval.
 */
// Today's cash for this PC's agent (credentials in headers or body).
router.get(
  "/cash",
  validate(machineCashSchema),
  asyncHandler(controller.getCashToday.bind(controller)),
);

router.post(
  "/cash",
  validate(machineCashSchema),
  asyncHandler(controller.getCashToday.bind(controller)),
);

// The agent's own two-step settlements (the CSP is informed, not asked).
router.post(
  "/cash/settlements",
  validate(machineSettlementSchema),
  asyncHandler(controller.createSettlement.bind(controller)),
);

router.post(
  "/cash/settlements/:settlementId",
  validate(machineSettlementActionSchema),
  asyncHandler(controller.actOnSettlement.bind(controller)),
);

router.post(
  "/cash/requests",
  validate(machineCashRequestSchema),
  asyncHandler(controller.createCashRequest.bind(controller)),
);

export default router;
