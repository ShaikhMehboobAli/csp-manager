import { Router } from "express";

import * as MachineController from "./machine.controller";
import machineAnalyticsRoutes from "./analytics/machine-analytics.routes";
import machineRuntimeRoute from "./runtime/machine-runtime.routes";
import { authMiddleware } from "../../core/middlewares/auth.middleware";
import {
  activationRateLimit,
  machineRuntimeRateLimit,
} from "../../core/middlewares/rate-limit.middleware";
import {
  machineHeaderCredentials,
  verifyMachineSignature,
} from "../../core/middlewares/machine-credentials.middleware";

const router = Router();

router.post(
  "/activate",
  activationRateLimit,
  MachineController.activateMachine,
);

// Activation form (desktop, before activating): pre-fill and KO email OTP.
router.post("/activate/preview", activationRateLimit, MachineController.previewActivation);
router.post("/activate/email/otp", activationRateLimit, MachineController.sendActivationEmailOtp);
router.post("/activate/email/verify", activationRateLimit, MachineController.verifyActivationEmail);

router.get("/list", authMiddleware, MachineController.getMachines);
router.get(
  "/:machineId/heartbeat",
  authMiddleware,
  MachineController.getHeartbeat,
);

router.get(
  "/:machineId/activity-sessions",
  authMiddleware,
  MachineController.getActivitySessions,
);

router.get("/:machineId", authMiddleware, MachineController.getMachine);

router.patch("/:machineId", authMiddleware, MachineController.updateMachine);
router.use(machineAnalyticsRoutes);

// Header credentials first (the rate limit keys on machineCode), then the
// request signature.
router.use(
  "/runtime",
  machineHeaderCredentials,
  machineRuntimeRateLimit,
  verifyMachineSignature,
  machineRuntimeRoute,
);

export default router;
