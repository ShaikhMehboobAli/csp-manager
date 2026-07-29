import { Router } from "express";

import * as AgentController from "../controller/agent.controller";
import { authMiddleware } from "../../../core/middlewares/auth.middleware";
import { validate } from "../../../core/middlewares/validate";
import { listAgentsSchema } from "../validations/list-agents.validation";

const router = Router();

router.post("/csp", authMiddleware, AgentController.createCSP);

router.post("/ko", authMiddleware, AgentController.createKO);

router.get(
  "/",
  authMiddleware,
  //   validate(listAgentsSchema, "query"),
  AgentController.listAgents,
);

router.get("/:agentId", authMiddleware, AgentController.getAgent);

export default router;
