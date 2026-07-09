import { z } from "zod";

export const verifyPaymentSchema = z.object({
  paymentId: z.string().cuid(),
  gatewayTransactionId: z.string().min(1),
  transactionReference: z.string().optional(),
});

export type VerifyPaymentDto = z.infer<typeof verifyPaymentSchema>;
