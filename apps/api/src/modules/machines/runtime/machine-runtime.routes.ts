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
  machineCustomTransactionSchema,
  machineDayCloseSchema,
  machineDaysSchema,
  machineDueActionSchema,
  machineDueSchema,
  machineExchangeSchema,
  machineSettlementActionSchema,
  machineSettlementSchema,
  machineTaskChangeSchema,
  machineTaskSchema,
} from "../../cash/cash.validation";
import { validate } from "../../../core/middlewares/validate";
import { machineIdempotency } from "../../../core/middlewares/machine-idempotency.middleware";

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
 * Cash management: the agent's cash comes in every heartbeat (`cash`).
 * Writes accept an `Idempotency-Key` header (a retry gets the first answer);
 * the POST forms of the reads don't need one.
 */
const CASH_READS = new Set(["/", "/labels", "/days"]);

router.use("/cash", (req, res, next) =>
  req.method === "GET" || (req.method === "POST" && CASH_READS.has(req.path))
    ? next()
    : machineIdempotency(req, res, next),
);

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

// Cash extras for this PC's agent. Reads are GET with the credentials in
// headers (signed or `Authorization: Machine <apiKey>`).

router.get(
  "/cash/labels",
  validate(machineCashSchema),
  asyncHandler(controller.getCashLabels.bind(controller)),
);

router.post(
  "/cash/labels",
  validate(machineCashSchema),
  asyncHandler(controller.getCashLabels.bind(controller)),
);

router.post(
  "/cash/custom-transactions",
  validate(machineCustomTransactionSchema),
  asyncHandler(controller.createCustomTransaction.bind(controller)),
);

router.get(
  "/cash/dues",
  validate(machineCashSchema),
  asyncHandler(controller.getDues.bind(controller)),
);

router.post(
  "/cash/dues",
  validate(machineDueSchema),
  asyncHandler(controller.createDue.bind(controller)),
);

router.get(
  "/cash/dues/:dueId",
  validate(machineCashSchema),
  asyncHandler(controller.getDue.bind(controller)),
);

router.post(
  "/cash/dues/:dueId",
  validate(machineDueActionSchema),
  asyncHandler(controller.actOnDue.bind(controller)),
);

router.get(
  "/cash/exchanges",
  validate(machineCashSchema),
  asyncHandler(controller.getExchanges.bind(controller)),
);

router.post(
  "/cash/exchanges",
  validate(machineExchangeSchema),
  asyncHandler(controller.createExchange.bind(controller)),
);

router.get(
  "/cash/day-close",
  validate(machineCashSchema),
  asyncHandler(controller.getDayClose.bind(controller)),
);

router.post(
  "/cash/day-close",
  validate(machineDayCloseSchema),
  asyncHandler(controller.closeDay.bind(controller)),
);

router.get(
  "/cash/days",
  validate(machineCashSchema),
  asyncHandler(controller.getCashDays.bind(controller)),
);

router.post(
  "/cash/days",
  validate(machineDaysSchema),
  asyncHandler(controller.getCashDays.bind(controller)),
);

router.get(
  "/cash/tasks",
  validate(machineCashSchema),
  asyncHandler(controller.getTasks.bind(controller)),
);

router.post(
  "/cash/tasks",
  validate(machineTaskSchema),
  asyncHandler(controller.createTask.bind(controller)),
);

router.patch(
  "/cash/tasks/:taskId",
  validate(machineTaskChangeSchema),
  asyncHandler(controller.updateTask.bind(controller)),
);

router.delete(
  "/cash/tasks/:taskId",
  validate(machineCashSchema),
  asyncHandler(controller.deleteTask.bind(controller)),
);

export default router;
