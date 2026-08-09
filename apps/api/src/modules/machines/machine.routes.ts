import { Router } from "express";

import * as MachineController from "./machine.controller";
import machineRuntimeRoute from "./runtime/machine-runtime.routes";
import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();

router.post("/activate", MachineController.activateMachine);

router.get("/list", authMiddleware, MachineController.getMachines);

router.get("/:machineId", authMiddleware, MachineController.getMachine);

router.patch("/:machineId", authMiddleware, MachineController.updateMachine);

router.use("/runtime", machineRuntimeRoute);

export default router;
