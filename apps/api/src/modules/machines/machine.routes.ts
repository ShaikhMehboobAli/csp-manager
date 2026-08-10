import { Router } from "express";

import * as MachineController from "./machine.controller";
import machineAnalyticsRoutes from "./analytics/machine-analytics.routes";
import machineRuntimeRoute from "./runtime/machine-runtime.routes";
import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();

router.post("/activate", MachineController.activateMachine);

router.get("/list", authMiddleware, MachineController.getMachines);
router.get(
  "/:machineId/heartbeat",
  authMiddleware,
  MachineController.getHeartbeat,
);

router.get("/:machineId", authMiddleware, MachineController.getMachine);

router.patch("/:machineId", authMiddleware, MachineController.updateMachine);
router.use(machineAnalyticsRoutes);

router.use("/runtime", machineRuntimeRoute);

export default router;
