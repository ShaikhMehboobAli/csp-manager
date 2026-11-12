import { Router } from "express";

import * as SubscriptionController from "./subscription.controller";

import { validate } from "../../core/middlewares/validate";

import { getPlansSchema } from "./validations/get-plans.validation";
import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";
import { updatePlanPricingSchema } from "./validations/update-plan-pricing.validation";

const router = Router();

router.get(
  "/plans",
  validate(getPlansSchema, "query"),
  SubscriptionController.getPlans,
);

// Plan prices are owned by SUPER_ADMIN (seeding never overwrites them).
router.patch(
  "/plans/:planId/pricing",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN),
  validate(updatePlanPricingSchema),
  SubscriptionController.updatePlanPricing,
);

router.get(
  "/current",
  authMiddleware,
  SubscriptionController.getCurrentSubscription,
);

// What the CSP's plan opens (app screens, desktop), renewal / mandate,
// upgrade window and cancel state. BC / admin: not gated.
router.get("/access", authMiddleware, SubscriptionController.getAccess);

// Price of a purchase or an upgrade (difference only) before create-order.
router.post(
  "/quote",
  authMiddleware,
  authorize(UserRole.CSP_ADMIN),
  SubscriptionController.quoteOrder,
);

// Cancel: no refund, usable until the end date, the UPI mandate is cancelled.
router.post(
  "/current/cancel",
  authMiddleware,
  authorize(UserRole.CSP_ADMIN),
  SubscriptionController.cancelSubscription,
);

router.get(
  "/history",
  authMiddleware,
  SubscriptionController.getSubscriptionHistory,
);

export default router;
