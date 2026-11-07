import { z } from "zod";

import {
  moneyValidator,
  requiredMoneyValidator,
} from "../../../core/validators/common.validator";

// Without these, a missing agentId reached Prisma as `where: { agentId:
// undefined }`, which matches the first agent in the table.
const agentFields = {
  agentId: z.string().trim().min(1, "Agent ID is required.").max(50),
  name: z.string().trim().min(2, "Name is required.").max(100),
  mobile: z.string().trim().min(10).max(15).optional(),
  email: z.string().trim().email("Invalid email address.").optional(),
  address: z.string().trim().max(500).optional(),
  // Kept for older clients; machines come from the owner's activations.
  machineCount: z.number().int().min(0).max(100).default(0),
};

/**
 * A KO shares its CSP's cash limit and cash in account, so it only brings
 * its own cash in hand (required). cashLimit / openingCashInAccount sent for
 * a KO are ignored.
 */
const koFields = {
  ...agentFields,
  // The KO's cash in hand, given by the CSP. Used only when the CSP's plan
  // has cash management (then required); ignored otherwise.
  openingCash: moneyValidator("Cash in hand"),
  // The new cash in hand of existing agents (CSP and/or KOs) the CSP moved
  // cash from / to in the form. Omit to take it from the CSP's own cash in
  // hand.
  cashAdjustments: z
    .array(
      z
        .object({
          agentId: z.string().trim().min(1).max(50),
          cashInHand: requiredMoneyValidator("Cash in hand"),
        })
        .strict(),
    )
    .max(51)
    .optional(),
};

/**
 * A new CSP needs its cash in hand and cash in account; the CSP limit is
 * their sum (`cashLimit` is ignored). For an existing CSP (a link request)
 * they're ignored.
 */
const cspFields = {
  ...agentFields,
  cashLimit: moneyValidator("CSP limit"),
  openingCash: moneyValidator("Cash in hand"),
  openingCashInAccount: moneyValidator("Cash in account"),
};

// KOs listed with a new CSP take their cash in hand from the CSP's.
const cspKoFields = {
  ...agentFields,
  openingCash: moneyValidator("Cash in hand"),
};

export const createKoSchema = z.object(koFields);

/** Replace a KO with a new one: the old KO's machine and cash move to it. */
export const replaceKoSchema = z.object({
  agentId: agentFields.agentId,
  name: agentFields.name,
  mobile: agentFields.mobile,
  email: agentFields.email,
  address: agentFields.address,
});

export type ReplaceKoDto = z.infer<typeof replaceKoSchema>;

export const createCspSchema = z.object({
  ...cspFields,
  kos: z.array(z.object(cspKoFields)).max(50).optional(),
});

export type CreateKoDto = z.infer<typeof createKoSchema>;
export type CreateCspDto = z.infer<typeof createCspSchema>;
