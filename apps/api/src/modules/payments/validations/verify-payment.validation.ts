import { z } from "zod";

/**
 * Razorpay: the three values Checkout's handler returns. Dev stand-in (no
 * Razorpay keys): gatewayTransactionId.
 */
export const verifyPaymentSchema = z
  .object({
    paymentId: z.string().cuid(),
    razorpayOrderId: z.string().min(1).max(64).optional(),
    razorpayPaymentId: z.string().min(1).max(64).optional(),
    razorpaySignature: z.string().min(1).max(256).optional(),
    gatewayTransactionId: z.string().min(1).optional(),
    transactionReference: z.string().optional(),
  })
  .refine(
    (data) => Boolean(data.razorpayPaymentId && data.razorpaySignature) || Boolean(data.gatewayTransactionId),
    "Send razorpayOrderId, razorpayPaymentId and razorpaySignature from Razorpay Checkout.",
  );

export type VerifyPaymentDto = z.infer<typeof verifyPaymentSchema>;
