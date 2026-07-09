import { Router } from "express";

import * as PaymentController from "./payment.controller";

import { authMiddleware } from "../../core/middlewares/auth.middleware";

import { createOrderSchema } from "./validations/create-order.validation";
import { validate } from "../../core/middlewares/validate";
import { verifyPaymentSchema } from "./validations/verify-payment.validation";
import { paymentWebhookSchema } from "./validations/webhook-payment.validation";

const router = Router();

router.post(
  "/create-order",
  authMiddleware,
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
  validate(paymentWebhookSchema),
  PaymentController.webhook,
);

export default router;
