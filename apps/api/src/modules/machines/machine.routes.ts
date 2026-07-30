import { Router } from "express";

import * as MachineController from "./machine.controller";

const router = Router();

router.post("/activate", MachineController.activateMachine);

export default router;
