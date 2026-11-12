import { createHash } from "node:crypto";

import { Request, Response } from "express";

import prisma from "../../config/prisma";
import { withTransaction } from "../../core/database/transaction";
import { RazorpayPayment, verifyWebhookSignature } from "../../core/services/razorpay.client";
import { Logger } from "../../core/utils/logger";
import { Prisma } from "../../generated/prisma/client";
import { PaymentPurpose, PaymentStatus } from "../../generated/prisma/enums";
import SubscriptionBillingService from "../subscriptions/billing/subscription-billing.service";

import PaymentService from "./payment.service";

type Body = {
  event: string;
  payload: {
    payment?: { entity: RazorpayPayment };
    order?: { entity: { id: string } };
    invoice?: { entity: { id: string; order_id?: string | null; payment_id?: string | null } };
    token?: { entity: { id: string; recurring_details?: { status?: string; failure_reason?: string | null } } };
  };
};

const notesOf = (payment: RazorpayPayment) => (Array.isArray(payment.notes) ? {} : payment.notes);

/** Our Payment row for a Razorpay payment: by notes.paymentId, else by order id. */
async function ourPayment(db: Prisma.TransactionClient, payment: RazorpayPayment) {
  const id = notesOf(payment).paymentId;

  if (id) {
    const byId = await db.payment.findUnique({ where: { id } });

    if (byId) return byId;
  }

  return payment.order_id ? db.payment.findFirst({ where: { transactionReference: payment.order_id } }) : null;
}

/** Applies one event. Returns false when it must wait (token not linked to a mandate yet). */
async function apply(body: Body, tx: Prisma.TransactionClient) {
  const billing = new SubscriptionBillingService(tx);
  const payment = body.payload.payment?.entity;

  switch (body.event) {
    case "payment.authorized":
    case "payment.captured":
    case "order.paid": {
      if (!payment) return true;

      // The purchase / approval link that registered UPI AutoPay now has its token.
      if (payment.token_id) {
        const registrationId = payment.invoice_id ?? payment.order_id;

        if (registrationId) {
          await billing.linkMandateToken({
            registrationId,
            tokenId: payment.token_id,
            customerId: payment.customer_id,
            approved: body.event !== "payment.authorized",
          });
        }
      }

      if (body.event === "payment.authorized") return true;

      const ours = await ourPayment(tx, payment);

      if (!ours) return true; // not ours (e.g. the ₹1 approval-link payment)

      if (ours.purpose === PaymentPurpose.RENEWAL) {
        await billing.completeRenewal(ours.id, payment.id);
      } else if (ours.status === PaymentStatus.PENDING) {
        await new PaymentService().completeFromRazorpay(ours.id, payment, tx);
      }

      return true;
    }

    case "payment.failed": {
      if (!payment) return true;

      const ours = await ourPayment(tx, payment);

      if (!ours || ours.status !== PaymentStatus.PENDING) return true;

      const reason = (payment.error_description ?? payment.error_reason ?? "The bank declined the payment.").slice(0, 300);

      if (ours.purpose === PaymentPurpose.RENEWAL) {
        // Razorpay already retried this debit: final for this attempt.
        await billing.failRenewal(ours.id, reason, false);
      } else {
        // Checkout: the customer can try again on the same order.
        await tx.payment.update({ where: { id: ours.id }, data: { failureReason: reason } });
      }

      return true;
    }

    case "invoice.paid": {
      const invoice = body.payload.invoice?.entity;

      if (invoice && payment?.token_id) {
        await billing.linkMandateToken({ registrationId: invoice.id, tokenId: payment.token_id, customerId: payment.customer_id, approved: true });
      }

      return true;
    }

    case "token.confirmed":
    case "token.rejected":
    case "token.cancelled":
    case "token.paused": {
      const token = body.payload.token?.entity;

      if (!token) return true;

      const status = body.event.slice("token.".length) as "confirmed" | "rejected" | "cancelled" | "paused";

      return billing.tokenStatusChanged(token.id, status, token.recurring_details?.failure_reason);
    }

    default:
      return true;
  }
}

function entityIdOf(body: Body) {
  return (
    body.payload.token?.entity.id ??
    body.payload.payment?.entity.id ??
    body.payload.invoice?.entity.id ??
    body.payload.order?.entity.id ??
    null
  );
}

/**
 * POST /payments/razorpay/webhook (set this URL and its secret in the
 * Razorpay Dashboard). Checks X-Razorpay-Signature over the raw body, applies
 * each event once (x-razorpay-event-id) and answers fast (Razorpay waits 5 s).
 * A processing error answers 500 so Razorpay retries.
 */
export const razorpayWebhook = async (req: Request, res: Response) => {
  const signature = req.get("x-razorpay-signature");
  const raw = req.rawBody;

  if (!signature || !raw || !verifyWebhookSignature(raw, signature)) {
    return res.status(400).json({ success: false, code: "INVALID_SIGNATURE", message: "Invalid webhook signature." });
  }

  const body = req.body as Body;
  const eventId = req.get("x-razorpay-event-id") ?? createHash("sha256").update(raw).digest("hex");

  const seen = await prisma.razorpayWebhookEvent.findUnique({ where: { id: eventId } });

  if (seen?.processedAt) {
    return res.status(200).json({ success: true, message: "Already processed." });
  }

  if (!seen) {
    await prisma.razorpayWebhookEvent
      .create({ data: { id: eventId, event: body.event, entityId: entityIdOf(body), payload: body as unknown as Prisma.InputJsonValue } })
      .catch(() => null); // a parallel delivery created it
  }

  try {
    const done = await withTransaction((tx) => apply(body, tx));

    await prisma.razorpayWebhookEvent.update({
      where: { id: eventId },
      data: done ? { processedAt: new Date(), error: null } : { error: "Waiting for the mandate to know this token." },
    });

    return res.status(200).json({ success: true, message: done ? "Processed." : "Stored." });
  } catch (error) {
    Logger.error(`[Razorpay webhook] ${body.event} ${eventId}: ${(error as Error).message}`);

    await prisma.razorpayWebhookEvent
      .update({ where: { id: eventId }, data: { error: (error as Error).message.slice(0, 500) } })
      .catch(() => null);

    return res.status(500).json({ success: false, code: "WEBHOOK_FAILED", message: "Could not process the event." });
  }
};
