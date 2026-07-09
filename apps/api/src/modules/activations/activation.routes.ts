import { Router } from "express";
import * as ActivationController from "./activation.controller";
import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();

router.get("/", authMiddleware, ActivationController.getActivations);

router.get(
  "/:activationId",
  authMiddleware,
  ActivationController.getActivationById,
);

router.post(
  "/:activationId/regenerate-password",
  authMiddleware,
  ActivationController.regeneratePassword,
);
export default router;
