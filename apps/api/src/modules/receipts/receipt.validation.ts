import { z } from "zod";
import {
  ReceiptStatus,
  ReceiptType,
  TransactionCategory,
} from "../../generated/prisma/enums";
import { LEDGER_RULES } from "../float/config/ledger-rule.config";

const MAX_DENOMINATION_COUNT = 10_000;
const MAX_RECEIPTS_PER_UPLOAD = 20;

const cashDenominationSchema = z
  .object({
    notes500: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
    notes200: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
    notes100: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
    notes50: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
    notes20: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
    notes10: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
    notes5: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
    coins20: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
    coins10: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
    coins5: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
    coins2: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
    coins1: z.number().int().nonnegative().max(MAX_DENOMINATION_COUNT).default(0),
  })
  .strict();

// Amount is required only for categories that create a float ledger entry.
const ledgerCategories = new Set<TransactionCategory>(
  (Object.keys(LEDGER_RULES) as TransactionCategory[]).filter(
    (category) => LEDGER_RULES[category].createLedger,
  ),
);

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

  // Optional extra fields; kept only when the super admin allows them.
  bankName: z.string().trim().max(100).optional(),
  balanceAfter: z.number().finite().optional(),
  bankTransactionId: z.string().trim().max(100).optional(),
  bankResponseCode: z.string().trim().max(50).optional(),
  bankResponseMessage: z.string().trim().max(500).optional(),
});

export const uploadReceiptSchema = z.object({
  machineCode: z.string().trim().min(1),

  // Optional when the request is signed with the device key (X-Signature).
  apiKey: z.string().trim().min(1).optional(),

  fingerprint: z.string().trim().min(1),

  receipts: z
    .array(receiptSchema)
    .min(1)
    .max(MAX_RECEIPTS_PER_UPLOAD, `At most ${MAX_RECEIPTS_PER_UPLOAD} receipts per upload.`),
});

export const minimalReceiptSchema = z
  .object({
    receiptId: z.string().trim().min(1, "Receipt ID is required"),
    receiptType: z.nativeEnum(ReceiptType),
    transactionCategory: z.nativeEnum(TransactionCategory),
    transactionType: z.string().trim().min(1),
    rrn: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).optional(),
    stan: z.string().trim().min(1).max(50).optional(),
    terminalId: z.string().trim().min(1).max(50).optional(),
    customerName: z.string().trim().min(1).max(200).optional(),
    customerAccount: z.string().trim().min(1).max(50).optional(),

    // Optional extra fields; kept only when the super admin allows them.
    bankName: z.string().trim().max(100).optional(),
    balanceAfter: z.number().finite().optional(),
    bankTransactionId: z.string().trim().max(100).optional(),
    bankResponseCode: z.string().trim().max(50).optional(),
    bankResponseMessage: z.string().trim().max(500).optional(),
    transactionAt: z.coerce.date().optional(),
    count: z.literal(1),
    amount: z.number().positive().finite().optional(),
    cashDenomination: cashDenominationSchema.optional(),
    // The outcome on SBI's receipt page. Only SUCCESS is recorded: a FAILED
    // or PENDING receipt is skipped (no count, commission or cash). Omitted
    // = SUCCESS (older desktops).
    status: z.nativeEnum(ReceiptStatus).optional(),
  })
  .superRefine((receipt, ctx) => {
    if (
      ledgerCategories.has(receipt.transactionCategory) &&
      receipt.amount === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Amount is required for cash and transfer transactions.",
      });
    }
  });

export const uploadReceiptCountsSchema = z.object({
  machineCode: z.string().trim().min(1),
  // Optional when the request is signed with the device key (X-Signature).
  apiKey: z.string().trim().min(1).optional(),
  fingerprint: z.string().trim().min(1),
  agentId: z.string().trim().min(1),
  // Each receipt is validated on its own in the service, so one bad receipt
  // is skipped instead of failing the batch. Bounded so one upload stays well
  // inside the DB transaction timeout.
  receipts: z
    .array(z.unknown())
    .min(1)
    .max(MAX_RECEIPTS_PER_UPLOAD, `At most ${MAX_RECEIPTS_PER_UPLOAD} receipts per upload.`),
});

/**
 * A list filter given as `a,b` or repeated (`?x=a&x=b`). Empty means no
 * filter.
 */
function listFilter<T extends z.ZodType<string>>(item: T) {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === "") {
        return undefined;
      }

      const values = (Array.isArray(value) ? value : [value])
        .flatMap((entry) => String(entry).split(","))
        .map((entry) => entry.trim())
        .filter(Boolean);

      return values.length > 0 ? [...new Set(values)] : undefined;
    },
    z.array(item).max(100).optional(),
  );
}

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

  // Several at once; each must be in the caller's scope. Omit for all.
  agentIds: listFilter(z.string().min(1).max(50)),

  receiptTypes: listFilter(z.nativeEnum(ReceiptType)),

  transactionCategories: listFilter(z.nativeEnum(TransactionCategory)),

  // from/to win over the period; no period and no dates = no date filter.
  period: z
    .enum(["TODAY", "YESTERDAY", "CURRENT_MONTH", "LAST_MONTH", "CUSTOM"])
    .optional(),

  sortBy: z
    .enum(["transactionAt", "createdAt", "amount"])
    .default("transactionAt"),

  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type ReceiptListQuery = z.infer<typeof receiptListSchema>;
export type UploadReceiptCountsRequest = z.infer<typeof uploadReceiptCountsSchema>;
export type MinimalReceipt = z.infer<typeof minimalReceiptSchema>;

/**
 * Validates one upload-counts receipt. An invalid receipt is reported with
 * its receiptId (when it has one) and the first problem found.
 */
export function parseMinimalReceipt(raw: unknown):
  | { success: true; receipt: MinimalReceipt }
  | { success: false; receiptId: string | null; reason: string } {
  const result = minimalReceiptSchema.safeParse(raw);

  if (result.success) {
    return { success: true, receipt: result.data };
  }

  const rawId =
    raw && typeof raw === "object"
      ? (raw as { receiptId?: unknown }).receiptId
      : undefined;

  const issue = result.error.issues[0];
  const field = issue?.path.join(".");

  return {
    success: false,
    receiptId: typeof rawId === "string" && rawId.trim() ? rawId.trim() : null,
    reason: issue
      ? `Invalid receipt${field ? ` (${field})` : ""}: ${issue.message}`
      : "Invalid receipt.",
  };
}

const machineCredentials = {
  machineCode: z.string().trim().min(1),
  // Optional when the request is signed with the device key (X-Signature).
  apiKey: z.string().trim().min(1).optional(),
  fingerprint: z.string().trim().min(1),
};

/** Desktop: upload URL for the slip image of an uploaded receipt. */
export const slipUploadUrlSchema = z.object({
  ...machineCredentials,
  receiptId: z.string().trim().min(1, "receiptId is required."),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"], {
    error: "contentType must be image/jpeg, image/png or image/webp.",
  }),
});

/** Desktop: the slip is uploaded; attach it to the receipt. */
export const slipConfirmSchema = z.object({
  ...machineCredentials,
  receiptId: z.string().trim().min(1, "receiptId is required."),
  key: z.string().trim().min(1, "key is required."),
});

export const receiptReportSchema = z
  .object({
    reason: z.enum(
      ["WRONG_AMOUNT", "WRONG_STATUS", "DUPLICATE", "MISSING_DETAILS", "NOT_MY_TRANSACTION", "OTHER"],
      { error: "reason must be WRONG_AMOUNT, WRONG_STATUS, DUPLICATE, MISSING_DETAILS, NOT_MY_TRANSACTION or OTHER." },
    ),
    details: z.string().trim().max(1000, "Details are too long.").optional(),
  })
  .strict();

const reportStatus = z.enum(["OPEN", "RESOLVED", "REJECTED"]);

export const receiptReportListSchema = z.object({
  status: reportStatus.optional(),
});

export const adminReceiptReportListSchema = z.object({
  status: reportStatus.optional(),
  ownerAgentId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const resolveReceiptReportSchema = z
  .object({
    status: z.enum(["RESOLVED", "REJECTED"]),
    resolution: z.string().trim().min(1, "Write what was done.").max(1000, "Resolution is too long."),
  })
  .strict();
