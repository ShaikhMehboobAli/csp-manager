import { Router } from "express";
import { webhookAuth } from "./webhook-auth.middleware";

import * as PaymentController from "./payment.controller";

import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";

import { createOrderSchema } from "./validations/create-order.validation";
import { validate } from "../../core/middlewares/validate";
import { verifyPaymentSchema } from "./validations/verify-payment.validation";
import { paymentWebhookSchema } from "./validations/webhook-payment.validation";

const router = Router();

router.post(
  "/create-order",
  authMiddleware,
  // Only a CSP or BC buys plans (KOs have no login; SUPER_ADMIN has none).
  authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN),
  validate(createOrderSchema),
  PaymentController.createOrder,
);

router.post(
  "/verify",
  authMiddleware,
  validate(verifyPaymentSchema),
  PaymentController.verifyPayment,
);

router.get("/history", authMiddleware, PaymentController.getPaymentHistory);

router.get("/:paymentId", authMiddleware, PaymentController.getPaymentDetails);

router.post(
  "/webhook",
  webhookAuth,
  validate(paymentWebhookSchema),
  PaymentController.webhook,
);

export default router;
