import { z } from "zod";

import { moneyValidator } from "../../../core/validators/common.validator";
import { drawerSchema } from "../../cash/cash.validation";

export const activateMachineSchema = z.object({
  agentId: z.string().trim().min(1),

  activationCode: z.string().trim().min(1),

  activationPassword: z.string().trim().min(1),

  // The agent's counted cash in hand and drawer (note/coin counts). Required
  // for a KO, optional for a CSP (then both together); the total of the
  // denomination must equal the cash in hand.
  cashInHand: moneyValidator("Cash in hand"),

  cashDenomination: drawerSchema.optional(),

  // Required when the counted cash in hand differs from what the CSP gave:
  // CASH_IN_ACCOUNT (the difference came from / went to cash in account) or
  // OTHER (the CSP brought cash in / took it out: the cash limit moves; the
  // CSP is notified).
  differenceSource: z.enum(["CASH_IN_ACCOUNT", "OTHER"]).optional(),

  machine: z.object({
    fingerprint: z.string().trim().min(1),

    machineName: z.string().optional(),

    watcherVersion: z.string().trim().min(1),

    osName: z.string().optional(),

    osVersion: z.string().optional(),

    deviceName: z.string().optional(),

    ipAddress: z.string().optional(),
    // ECDSA P-256 public key (SPKI, PEM or base64 DER) of a device key created
    // on this PC. When sent, every later request must be signed with it.
    devicePublicKey: z.string().trim().min(1).max(2000).optional(),
  }),
});

const activationCredentials = {
  agentId: z.string().trim().min(1),
  activationCode: z.string().trim().min(1),
  activationPassword: z.string().trim().min(1),
};

export const activationPreviewSchema = z.object(activationCredentials);

export const activationEmailOtpSchema = z.object({
  ...activationCredentials,
  email: z.string().trim().email("Invalid email address.").optional(),
});

export const activationEmailVerifySchema = z.object({
  ...activationCredentials,
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit OTP."),
});
