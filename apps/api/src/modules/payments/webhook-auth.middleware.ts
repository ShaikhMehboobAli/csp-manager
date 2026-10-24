import { timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";

import { env } from "../../config/env";
import { UnauthorizedError } from "../../core/errors/UnauthorizedError";

/**
 * Protects the payment webhook with a shared secret sent in the
 * `x-webhook-secret` header. Fails closed when no secret is configured.
 *
 * Replace with the gateway's signature verification (e.g. Razorpay
 * `x-razorpay-signature`) when a real payment provider is integrated.
 */
export const webhookAuth = (req: Request, res: Response, next: NextFunction) => {
  const expected = env.paymentWebhookSecret;

  const received = req.header("x-webhook-secret") ?? "";

  if (
    !expected ||
    received.length !== expected.length ||
    !timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  ) {
    throw new UnauthorizedError("Invalid webhook secret.");
  }

  next();
};
