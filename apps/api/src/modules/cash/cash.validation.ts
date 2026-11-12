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
    // The cash limit is worked out (all cash in hand + cash in account + …);
    // sending one is refused.
    cashLimit: z
      .unknown()
      .optional()
      .refine((value) => value === undefined, {
        message:
          "The cash limit can't be set: it is cash in hand + cash in account (+ balance due). Change those instead.",
      }),
    cashInAccount: moneyValidator("Cash in account"),
    // Clears (or corrects) what partly delivered KO settlements left in bank.
    cashLeftInBank: moneyValidator("Left in bank"),
    // Clears (or corrects) the net cash from custom transactions and dues; may be negative.
    cashOther: z
      .number({ error: "Other cash must be a number." })
      .finite()
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Other cash can have at most 2 decimals.")
      .optional(),
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
      data.cashInAccount !== undefined ||
      data.cashLeftInBank !== undefined ||
      data.cashOther !== undefined ||
      (data.agents?.length ?? 0) > 0,
    { message: "Nothing to change." },
  );

/**
 * Increase / decrease (app button): cash brought in or taken out of one
 * agent's cash in hand, or the shared cash in account. The limit moves.
 */
const changeSchema = z
  .object({
    type: z.enum(["INCREASE", "DECREASE"]),
    target: z.enum(["CASH_IN_HAND", "CASH_IN_ACCOUNT"]),
    // CASH_IN_HAND: whose (the CSP itself only with a running machine).
    agentId: z.string().trim().min(1).optional(),
    amount: positiveMoney("Amount"),
    remarks: z.string().trim().min(1, "Remarks are required.").max(500),
  })
  .strict()
  .refine((data) => data.target === "CASH_IN_ACCOUNT" || !!data.agentId, {
    message: "agentId is required to change an agent's cash in hand.",
    path: ["agentId"],
  });

export const cashTransactionSchema = z.union([
  z.discriminatedUnion("type", [settlementSchema, adjustmentSchema]),
  changeSchema,
]);

export const cashAdjustmentsQuerySchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  status: z.enum(["PENDING", "COMPLETED", "CANCELLED"]).optional(),
});

/** Desktop: the agent counted the notes for the CSP's change. */
export const machineAdjustmentCompleteSchema = z
  .object({
    machineCode: z.string().trim().min(1),
    apiKey: z.string().optional(),
    fingerprint: z.string().trim().min(1),
    // The whole counted drawer, or only the notes given / taken.
    drawer: drawerSchema.optional(),
    notes: drawerSchema.optional(),
  })
  .refine((data) => !!data.drawer !== !!data.notes, {
    message: "Send either drawer (the whole count) or notes (given / taken), not both.",
  });

/** Desktop: one-step move between cash in hand and cash in account. */
export const machineTransferSchema = z.object({
  machineCode: z.string().trim().min(1),
  apiKey: z.string().optional(),
  fingerprint: z.string().trim().min(1),
  direction: z.enum(["HAND_TO_ACCOUNT", "ACCOUNT_TO_HAND"]),
  amount: positiveMoney("Amount"),
  // Notes taken out of (HAND_TO_ACCOUNT) or put into the drawer; total = amount.
  cashDenomination: drawerSchema,
  remarks: z.string().trim().max(500).optional(),
});

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

// -----------------------------------------------------------------------------
// Desktop cash extras: custom transactions, balance due, exchange, day close,
// history, tasks
// -----------------------------------------------------------------------------

const istDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-02.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Use a real date.");

const amountMoreThanZero = (label = "Amount") =>
  requiredMoney(label).refine((value) => value > 0, "Enter an amount more than ₹0.");

/** Every one of the 12 note/coin keys. */
const fullDrawerSchema = z
  .object(
    Object.fromEntries(
      DRAWER_KEYS.map((key) => [key, z.number().int().min(0).max(100_000)]),
    ) as Record<(typeof DRAWER_KEYS)[number], z.ZodNumber>,
  )
  .strict();

const note = (max: number, message: string) => z.string().trim().max(max, message);

export const machineDateQuerySchema = z.object({ date: istDay.optional() });

export const machineDaysQuerySchema = z.object({
  from: istDay.optional(),
  to: istDay.optional(),
});

/** POST form of the day list: credentials and the range in the body. */
export const machineDaysSchema = machineCashSchema.extend(machineDaysQuerySchema.shape);

export const machineCustomTransactionSchema = z.object({
  ...machineCredentials,
  labelId: z.string().trim().min(1, "Pick a label."),
  direction: z.enum(["IN", "OUT"]),
  amount: amountMoreThanZero(),
  paidNow: requiredMoney("Paid now"),
  cashDenomination: drawerSchema.optional(),
  note: note(200, "Keep the note under 200 characters.").optional(),
});

export const machineDuesQuerySchema = z.object({
  status: z.enum(["OPEN", "CLOSED"]).default("OPEN"),
});

export const machineDueSchema = z.object({
  ...machineCredentials,
  kind: z.enum(["TO_COLLECT", "TO_GIVE"], { error: "Pick to collect or to give." }),
  amount: amountMoreThanZero(),
  note: z
    .string({ error: "Say what it's for." })
    .trim()
    .min(1, "Say what it's for.")
    .max(200, "Keep the note under 200 characters."),
  receiptId: z.string().trim().min(1).max(64).nullable().optional(),
  // Dues without a receipt: where the amount goes now (left out = nothing moves).
  cashSide: z
    .enum(["CASH_IN_HAND", "CASH_IN_ACCOUNT", "OTHER_CASH"], {
      error: "Choose where to add / deduct the amount.",
    })
    .optional(),
  // Receipt dues (required when the receipt's cash was applied): the notes
  // not received (to collect) or not paid out (to give).
  cashDenomination: drawerSchema.optional(),
});

export const machineDueActionSchema = z
  .object({
    ...machineCredentials,
    action: z.enum(["SETTLE", "CANCEL"]),
    amount: amountMoreThanZero().optional(),
    cashDenomination: drawerSchema.optional(),
  })
  .refine((data) => data.action !== "SETTLE" || data.amount !== undefined, {
    message: "Enter an amount more than ₹0.",
  })
  .refine((data) => data.action !== "SETTLE" || data.cashDenomination !== undefined, {
    message: "Cash denomination is required: the notes taken or given.",
  });

export const machineExchangeSchema = z.object({
  ...machineCredentials,
  taken: drawerSchema,
  given: drawerSchema,
  note: note(200, "Keep the note under 200 characters.").optional(),
});

export const machineDayCloseSchema = z.object({
  ...machineCredentials,
  countedCashInHand: requiredMoney("Counted cash in hand"),
  countedDrawer: fullDrawerSchema,
  // Optional: the cash in account SBI shows now (nothing moves; compared only).
  countedCashInAccount: moneyValidator("Counted cash in account"),
});

/** Desktop: the notes of a cash receipt uploaded without them ("Count needed"). */
export const machineReceiptCountSchema = z.object({
  ...machineCredentials,
  cashDenomination: fullDrawerSchema,
});

export const receiptCountStatusQuerySchema = z.object({
  status: z.enum(["PENDING", "DONE", "ALL"]).default("PENDING"),
});

const taskTitle = z
  .string()
  .trim()
  .min(1, "Write what needs doing.")
  .max(100, "Keep it under 100 characters.");
const taskNote = z.string().trim().max(300, "Keep the note under 300 characters.").nullable();
const taskDueAt = z.coerce.date({ error: "Use an ISO date and time." }).nullable();

export const taskStatusQuerySchema = z.object({
  status: z.enum(["OPEN", "DONE", "ALL"]).default("ALL"),
});

export const machineTaskSchema = z.object({
  ...machineCredentials,
  title: taskTitle,
  note: taskNote.optional(),
  dueAt: taskDueAt.optional(),
});

export const machineTaskChangeSchema = z.object({
  ...machineCredentials,
  title: taskTitle.optional(),
  note: taskNote.optional(),
  dueAt: taskDueAt.optional(),
  done: z.boolean().optional(),
});

// CSP app

export const cashLabelSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(60, "Keep the name under 60 characters."),
    direction: z.enum(["IN", "OUT", "BOTH"]),
  })
  .strict();

export const cashLabelChangeSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(60, "Keep the name under 60 characters.").optional(),
    direction: z.enum(["IN", "OUT", "BOTH"]).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to change." });

export const cashAgentQuerySchema = z.object({
  agentId: z.string().trim().min(1).optional(),
});

export const cashDuesQuerySchema = cashAgentQuerySchema.extend({
  status: z.enum(["OPEN", "CLOSED"]).default("OPEN"),
});

export const cashDayClosesQuerySchema = cashAgentQuerySchema.extend({
  from: istDay.optional(),
  to: istDay.optional(),
});

export const cashTasksQuerySchema = cashAgentQuerySchema.extend({
  status: z.enum(["OPEN", "DONE", "ALL"]).default("ALL"),
});

export const cspTaskSchema = z
  .object({
    agentId: z.string().trim().min(1, "Pick an agent."),
    title: taskTitle,
    note: taskNote.optional(),
    dueAt: taskDueAt.optional(),
  })
  .strict();

export const cspTaskChangeSchema = z
  .object({
    title: taskTitle.optional(),
    note: taskNote.optional(),
    dueAt: taskDueAt.optional(),
    done: z.boolean().optional(),
  })
  .strict();
