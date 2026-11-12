import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../../config/env";
import { AppError } from "../errors/AppError";
import { Logger } from "../utils/logger";

const BASE_URL = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 10_000;

export const razorpayEnabled = () => Boolean(env.razorpayKeyId && env.razorpayKeySecret);

/** Rupees (number or Decimal string) → paise. */
export const toPaise = (rupees: number | string) => Math.round(Number(rupees) * 100);

export type RazorpayPayment = {
  id: string;
  entity: "payment";
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  order_id: string | null;
  invoice_id?: string | null;
  method: string;
  token_id?: string | null;
  customer_id?: string | null;
  notes: Record<string, string> | [];
  error_code?: string | null;
  error_description?: string | null;
  error_reason?: string | null;
};

export type RazorpayOrder = { id: string; amount: number; currency: string; status: string; notes: Record<string, string> | [] };

type Customer = { name?: string | null; email?: string | null; contact?: string | null };

function sameHex(expected: string, actual: string) {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");

  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checkout success: HMAC-SHA256(order_id + "|" + payment_id, key secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const expected = createHmac("sha256", env.razorpayKeySecret).update(`${orderId}|${paymentId}`).digest("hex");

  return sameHex(expected, signature);
}

/** Webhook: HMAC-SHA256 of the raw body with the webhook secret (X-Razorpay-Signature). */
export function verifyWebhookSignature(rawBody: Buffer, signature: string) {
  if (!env.razorpayWebhookSecret) {
    return false;
  }

  const expected = createHmac("sha256", env.razorpayWebhookSecret).update(rawBody).digest("hex");

  return sameHex(expected, signature);
}

/**
 * Minimal Razorpay REST client (Basic auth with the key id / secret). Every
 * gateway error becomes 502 PAYMENT_GATEWAY_ERROR with a safe message; the
 * details go to the log.
 */
export class RazorpayClient {
  private async request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
    if (!razorpayEnabled()) {
      throw new AppError("Online payments aren't set up yet.", 503, "PAYMENT_GATEWAY_NOT_CONFIGURED");
    }

    let response: Response;

    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64")}`,
          ...(body !== undefined && { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      Logger.error(`[Razorpay] ${method} ${path} failed: ${(error as Error).message}`);

      throw new AppError("The payment gateway didn't answer. Please try again.", 502, "PAYMENT_GATEWAY_ERROR");
    }

    const text = await response.text();
    const json = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const description: string = json?.error?.description ?? text.slice(0, 300);

      Logger.error(`[Razorpay] ${method} ${path} → ${response.status}: ${description}`);

      throw new AppError(`Payment gateway error: ${description}`, 502, "PAYMENT_GATEWAY_ERROR", {
        gatewayCode: json?.error?.code ?? null,
        gatewayReason: json?.error?.reason ?? null,
      });
    }

    return json as T;
  }

  /** Returns the existing customer for the same email / contact (fail_existing "0"). */
  createCustomer(customer: Customer & { notes?: Record<string, string> }) {
    return this.request<{ id: string }>("POST", "/customers", {
      name: customer.name ?? undefined,
      email: customer.email ?? undefined,
      contact: customer.contact ?? undefined,
      fail_existing: "0",
      notes: customer.notes,
    });
  }

  /** One-time order, or (with `upiMandate`) the order whose payment also registers UPI AutoPay. */
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
    upiMandate?: { customerId: string; maxAmountPaise: number; expireAt: Date };
  }) {
    return this.request<RazorpayOrder>("POST", "/orders", {
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt.slice(0, 40),
      payment_capture: true,
      notes: input.notes,
      ...(input.upiMandate && {
        customer_id: input.upiMandate.customerId,
        method: "upi",
        token: {
          max_amount: input.upiMandate.maxAmountPaise,
          expire_at: Math.floor(input.upiMandate.expireAt.getTime() / 1000),
          frequency: "monthly",
        },
      }),
    });
  }

  fetchPayment(paymentId: string) {
    return this.request<RazorpayPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
  }

  /** A monthly debit on an approved UPI token (Razorpay sends the pre-debit notice, debits ~25 h later, retries itself). */
  createRecurringPayment(input: {
    orderId: string;
    customerId: string;
    tokenId: string;
    amountPaise: number;
    email: string;
    contact: string;
    description: string;
    notes: Record<string, string>;
  }) {
    return this.request<{ razorpay_payment_id: string }>("POST", "/payments/create/recurring", {
      email: input.email,
      contact: input.contact,
      amount: input.amountPaise,
      currency: "INR",
      order_id: input.orderId,
      customer_id: input.customerId,
      token: input.tokenId,
      recurring: true,
      description: input.description.slice(0, 50),
      notes: input.notes,
    });
  }

  /** Registration link (when the CSP must approve a new mandate outside a purchase). */
  createUpiRegistrationLink(input: {
    customer: Required<Customer>;
    maxAmountPaise: number;
    expireAt: Date;
    receipt: string;
    description: string;
    notes: Record<string, string>;
  }) {
    return this.request<{ id: string; short_url: string; order_id: string | null }>("POST", "/subscription_registration/auth_links", {
      customer: input.customer,
      type: "link",
      amount: 100,
      currency: "INR",
      description: input.description,
      receipt: input.receipt.slice(0, 40),
      subscription_registration: {
        method: "upi",
        max_amount: input.maxAmountPaise,
        expire_at: Math.floor(input.expireAt.getTime() / 1000),
        frequency: "monthly",
      },
      email_notify: true,
      sms_notify: true,
      notes: input.notes,
    });
  }

  cancelToken(customerId: string, tokenId: string) {
    return this.request<{ status: string }>(
      "PUT",
      `/customers/${encodeURIComponent(customerId)}/tokens/${encodeURIComponent(tokenId)}/cancel`,
    );
  }
}
