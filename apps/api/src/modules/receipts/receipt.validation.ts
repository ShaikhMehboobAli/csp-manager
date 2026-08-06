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

export const receiptListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),

  from: z.coerce.date().optional(),

  to: z.coerce.date().optional(),

  machineId: z.string().trim().optional(),

  receiptType: z.nativeEnum(ReceiptType).optional(),

  transactionCategory: z.nativeEnum(TransactionCategory).optional(),

  status: z.nativeEnum(ReceiptStatus).optional(),

  search: z.string().trim().optional(),

  agentId: z.string().optional(),

  sortBy: z
    .enum(["transactionAt", "createdAt", "amount"])
    .default("transactionAt"),

  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type ReceiptListQuery = z.infer<typeof receiptListSchema>;
