import { Router } from "express";

import * as MachineController from "./machine.controller";
import machineRuntimeRoute from "./runtime/machine-runtime.routes";

const router = Router();

router.post("/activate", MachineController.activateMachine);

router.use("/runtime", machineRuntimeRoute);

export default router;
