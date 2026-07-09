import { z } from "zod";

export const paymentWebhookSchema = z.object({
  paymentId: z.string().cuid(),

  gatewayTransactionId: z.string().min(1),

  transactionReference: z.string().optional(),
});

export type PaymentWebhookDto = z.infer<typeof paymentWebhookSchema>;
