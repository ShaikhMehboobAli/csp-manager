import { z } from "zod";

import {
  moneyValidator,
  requiredMoneyValidator,
} from "../../core/validators/common.validator";
import {
  CashLedgerType,
  CashRequestStatus,
  CashSettlementDirection,
  CashSettlementStatus,
} from "../../generated/prisma/enums";

import { DRAWER_KEYS } from "./cash.constants";

const requiredMoney = requiredMoneyValidator;

const positiveMoney = (label: string) =>
  requiredMoney(label).refine((value) => value > 0, `${label} must be more than 0.`);

/** Note/coin counts; keys left out keep their count. */
export const drawerSchema = z
  .object(
    Object.fromEntries(
      DRAWER_KEYS.map((key) => [key, z.number().int().min(0).max(100_000).optional()]),
    ) as Record<(typeof DRAWER_KEYS)[number], z.ZodOptional<z.ZodNumber>>,
  )
  .strict();

const list = <T extends z.ZodType<string>>(item: T) =>
  z.preprocess(
    (value) =>
      value === undefined || value === ""
        ? undefined
        : (Array.isArray(value) ? value : [value])
            .flatMap((entry) => String(entry).split(","))
            .map((entry) => entry.trim())
            .filter(Boolean),
    z.array(item).max(100).optional(),
  );

export const cashViewSchema = z.object({
  // BC / super admin: required (a CSP or one of its KOs). CSP: optional, to
  // show one of its KOs on its own.
  agentId: z.string().trim().min(1).optional(),
});

const settlementSchema = z
  .object({
    type: z.literal("SETTLEMENT"),
    agentId: z.string().trim().min(1, "Agent ID is required."),
    amount: positiveMoney("Amount"),
    direction: z.enum(["ACCOUNT_TO_HAND", "HAND_TO_ACCOUNT"]),
    remarks: z.string().trim().max(500).optional(),
  })
  .strict();

const adjustmentSchema = z
  .object({
    type: z.literal("ADJUSTMENT"),
    cashLimit: moneyValidator("Cash limit"),
    cashInAccount: moneyValidator("Cash in account"),
    // Clears (or corrects) what partly delivered KO settlements left in bank.
    cashLeftInBank: moneyValidator("Left in bank"),
    agents: z
      .array(
        z
          .object({
            agentId: z.string().trim().min(1),
            cashInHand: moneyValidator("Cash in hand"),
            drawer: drawerSchema.optional(),
          })
          .strict(),
      )
      .max(51)
      .optional(),
    // Every manual change is audited with a reason.
    remarks: z.string().trim().min(1, "Remarks are required.").max(500),
  })
  .strict()
  .refine(
    (data) =>
      data.cashLimit !== undefined ||
      data.cashInAccount !== undefined ||
      data.cashLeftInBank !== undefined ||
      (data.agents?.length ?? 0) > 0,
    { message: "Nothing to change." },
  );

export const cashTransactionSchema = z.discriminatedUnion("type", [
  settlementSchema,
  adjustmentSchema,
]);

export const cashLedgerQuerySchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  // Individual agents (else all agents of the CSP).
  agentIds: list(z.string().min(1).max(50)),
  types: list(z.nativeEnum(CashLedgerType)),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  period: z.enum(["TODAY", "YESTERDAY", "CURRENT_MONTH", "LAST_MONTH", "CUSTOM"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const cashRequestsQuerySchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  status: z.nativeEnum(CashRequestStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const reviewCashRequestSchema = z
  .object({
    action: z.enum(["APPROVE", "REJECT"]),
    remarks: z.string().trim().max(500).optional(),
  })
  .strict();

/** Desktop: a KO (or CSP) machine asks the CSP to change its cash in hand. */
export const machineCashRequestSchema = z.object({
  machineCode: z.string().trim().min(1),
  apiKey: z.string().optional(),
  fingerprint: z.string().trim().min(1),
  cashInHand: requiredMoney("Cash in hand"),
  drawer: drawerSchema.optional(),
  reason: z.string().trim().min(1, "Reason is required.").max(500),
});

export const machineCashSchema = z.object({
  machineCode: z.string().trim().min(1),
  apiKey: z.string().optional(),
  fingerprint: z.string().trim().min(1),
});

const machineCredentials = {
  machineCode: z.string().trim().min(1),
  apiKey: z.string().optional(),
  fingerprint: z.string().trim().min(1),
};

/** Desktop: the agent starts a settlement (step 1; BANK_TO_HAND: its only step, from cash left in bank). */
export const machineSettlementSchema = z.object({
  ...machineCredentials,
  direction: z.nativeEnum(CashSettlementDirection),
  amount: positiveMoney("Amount"),
  // HAND_TO_ACCOUNT: the notes taken out of the drawer (total = amount).
  cashDenomination: drawerSchema.optional(),
  remarks: z.string().trim().max(500).optional(),
});

/** Desktop: the agent approves or cancels its own open step. */
export const machineSettlementActionSchema = z.object({
  ...machineCredentials,
  action: z.enum(["APPROVE", "CANCEL"]),
  // Bank → cash in hand (ACCOUNT_TO_HAND step 2, BANK_TO_HAND): the notes received (total ≤ amount).
  cashDenomination: drawerSchema.optional(),
  // Step 2 of HAND_TO_ACCOUNT: the amount credited (≤ amount; default all).
  amount: positiveMoney("Amount").optional(),
  remarks: z.string().trim().max(500).optional(),
});

export const cashSettlementsQuerySchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  agentIds: list(z.string().min(1).max(50)),
  status: z.nativeEnum(CashSettlementStatus).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  period: z.enum(["TODAY", "YESTERDAY", "CURRENT_MONTH", "LAST_MONTH", "CUSTOM"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
