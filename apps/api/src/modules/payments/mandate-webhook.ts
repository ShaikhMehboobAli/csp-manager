import { Request, Response } from "express";
import { z } from "zod";

import { withTransaction } from "../../core/database/transaction";
import SubscriptionBillingService from "../subscriptions/billing/subscription-billing.service";

/**
 * Gateway events for UPI mandates (shared-secret webhook, like /webhook).
 * Replace the payload mapping with Razorpay's subscription / token events
 * when it's integrated (pre-production checklist).
 */
export const mandateWebhookSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("MANDATE_ACTIVATED"), mandateId: z.string().min(1) }),
  z.object({
    event: z.literal("MANDATE_REVOKED"),
    mandateId: z.string().min(1),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    event: z.literal("CHARGE_SUCCEEDED"),
    paymentId: z.string().min(1),
    gatewayTransactionId: z.string().min(1),
  }),
  z.object({
    event: z.literal("CHARGE_FAILED"),
    paymentId: z.string().min(1),
    reason: z.string().min(1).max(500),
    // false: the payment method can't be retried (mandate gone).
    retryable: z.boolean().default(true),
  }),
]);

export const mandateWebhook = async (req: Request, res: Response) => {
  const event = mandateWebhookSchema.parse(req.body);

  await withTransaction(async (tx) => {
    const billing = new SubscriptionBillingService(tx);

    switch (event.event) {
      case "MANDATE_ACTIVATED":
        await billing.mandateActivated(event.mandateId);
        break;
      case "MANDATE_REVOKED":
        await billing.mandateRevoked(event.mandateId, event.reason);
        break;
      case "CHARGE_SUCCEEDED":
        await billing.completeRenewal(event.paymentId, event.gatewayTransactionId);
        break;
      case "CHARGE_FAILED":
        await billing.failRenewal(event.paymentId, event.reason, event.retryable);
        break;
    }
  });

  return res.status(200).json({ success: true, message: "Mandate event processed." });
};
