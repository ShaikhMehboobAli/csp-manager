import { Router } from "express";
import { webhookAuth } from "./webhook-auth.middleware";

import * as PaymentController from "./payment.controller";

import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";
import { paymentRateLimit } from "../../core/middlewares/rate-limit.middleware";

import { createOrderSchema } from "./validations/create-order.validation";
import { validate } from "../../core/middlewares/validate";
import { verifyPaymentSchema } from "./validations/verify-payment.validation";
import { paymentWebhookSchema } from "./validations/webhook-payment.validation";
import { mandateWebhook } from "./mandate-webhook";
import { razorpayWebhook } from "./razorpay-webhook";
import { razorpayEnabled } from "../../core/services/razorpay.client";
import { withTransaction } from "../../core/database/transaction";
import SubscriptionBillingService from "../subscriptions/billing/subscription-billing.service";
import { NextFunction, Request, Response } from "express";

/** Shared-secret test webhooks: only while Razorpay isn't configured (dev stand-in). */
const devGatewayOnly = (_req: Request, res: Response, next: NextFunction) =>
  razorpayEnabled()
    ? res.status(404).json({ success: false, code: "NOT_FOUND", message: "Not found." })
    : next();

const router = Router();

router.post(
  "/create-order",
  authMiddleware,
  // Only a CSP or BC buys plans (KOs have no login; SUPER_ADMIN has none).
  authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN),
  paymentRateLimit,
  validate(createOrderSchema),
  PaymentController.createOrder,
);

router.post(
  "/verify",
  authMiddleware,
  paymentRateLimit,
  validate(verifyPaymentSchema),
  PaymentController.verifyPayment,
);

router.get("/history", authMiddleware, PaymentController.getPaymentHistory);

// Razorpay events (signature-checked; set this URL in the Razorpay Dashboard).
router.post("/razorpay/webhook", razorpayWebhook);

// CSP: a UPI AutoPay approval link for the running plan (no approved mandate yet).
router.post(
  "/mandates/setup",
  authMiddleware,
  authorize(UserRole.CSP_ADMIN),
  paymentRateLimit,
  async (req: Request, res: Response) => {
    const mandate = await withTransaction((tx) => new SubscriptionBillingService(tx).setUpMandate(req.user!.agentId));

    res.status(200).json({
      success: true,
      message:
        mandate.status === "ACTIVE"
          ? "UPI AutoPay is already set up."
          : mandate.authUrl
            ? "Open the link and approve UPI AutoPay in your UPI app."
            : "We couldn't make the approval link right now. Please try again in a minute.",
      data: {
        mandateId: mandate.id,
        status: mandate.status,
        authUrl: mandate.authUrl,
        amount: mandate.amount.toFixed(2),
        maxAmount: mandate.maxAmount?.toFixed(2) ?? null,
      },
    });
  },
);

// Dev stand-in only: UPI mandate events (activated, revoked, renewal charge result).
router.post("/mandates/webhook", devGatewayOnly, webhookAuth, mandateWebhook);

router.get("/:paymentId", authMiddleware, PaymentController.getPaymentDetails);

router.post(
  "/webhook",
  devGatewayOnly,
  webhookAuth,
  validate(paymentWebhookSchema),
  PaymentController.webhook,
);

export default router;
