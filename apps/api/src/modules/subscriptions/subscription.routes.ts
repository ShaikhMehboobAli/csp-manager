import { Router } from "express";

import * as SubscriptionController from "./subscription.controller";

import { validate } from "../../core/middlewares/validate";

import { getPlansSchema } from "./validations/get-plans.validation";
import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();

router.get(
  "/plans",
  validate(getPlansSchema, "query"),
  SubscriptionController.getPlans,
);

router.get(
  "/current",
  authMiddleware,
  SubscriptionController.getCurrentSubscription,
);

router.get(
  "/history",
  authMiddleware,
  SubscriptionController.getSubscriptionHistory,
);

export default router;
