import { Router } from "express";
import { authorize } from "../../../core/middlewares/authorize.middleware";
import { UserRole } from "../../../generated/prisma/enums";

import * as AgentController from "../controller/agent.controller";
import { authMiddleware } from "../../../core/middlewares/auth.middleware";
import { validate } from "../../../core/middlewares/validate";
import { listAgentsSchema } from "../validations/list-agents.validation";

const router = Router();

router.post(
  "/csp",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN, UserRole.BC_ADMIN),
  AgentController.createCSP,
);

router.post(
  "/ko",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN, UserRole.CSP_ADMIN),
  AgentController.createKO,
);

router.get(
  "/",
  authMiddleware,
  //   validate(listAgentsSchema, "query"),
  AgentController.listAgents,
);

router.get("/:agentId", authMiddleware, AgentController.getAgent);
router.patch("/:agentId", authMiddleware, AgentController.updateAgent);
router.delete("/:agentId", authMiddleware, AgentController.deleteAgent);

export default router;
