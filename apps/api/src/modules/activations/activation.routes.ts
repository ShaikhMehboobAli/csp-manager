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
export default router;
