import { z } from "zod";
import {
  ReceiptStatus,
  ReceiptType,
  TransactionCategory,
} from "../../generated/prisma/enums";

const receiptSchema = z.object({
  receiptId: z.string().trim().min(1, "Receipt ID is required"),
  receiptType: z.nativeEnum(ReceiptType),

  transactionCategory: z.nativeEnum(TransactionCategory),

  transactionType: z.string().trim().min(1),

  status: z.nativeEnum(ReceiptStatus),

  transactionAt: z.coerce.date(),

  amount: z.number().positive(),

  charges: z.number().min(0).optional(),

  stan: z.string().trim().optional(),

  rrn: z.string().trim().optional(),

  terminalId: z.string().trim().optional(),

  customerName: z.string().trim().optional(),

  customerAccount: z.string().trim().optional(),

  location: z.string().trim().optional(),
});

export const uploadReceiptSchema = z.object({
  machineCode: z.string().trim().min(1),

  apiKey: z.string().trim().min(1),

  fingerprint: z.string().trim().min(1),

  receipts: z.array(receiptSchema).min(1),
});
