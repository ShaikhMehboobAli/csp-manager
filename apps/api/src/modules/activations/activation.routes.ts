import { Router } from "express";
import * as ActivationController from "./activation.controller";
import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { validate } from "../../core/middlewares/validate";
import { assignActivationSchema } from "./activation.validation";

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

router.post(
  "/assign",
  authMiddleware,
  validate(assignActivationSchema),
  ActivationController.assignActivation,
);
export default router;
