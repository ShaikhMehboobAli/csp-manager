import { z } from "zod";

import {
  accountTypeValidator,
  addressValidator,
  agentIdValidator,
  emailValidator,
  moneyValidator,
  nameValidator,
  passwordValidator,
  phoneValidator,
} from "../../../core/validators/common.validator";

export const signupSchema = z
  .object({
    accountType: accountTypeValidator,

    name: nameValidator,

    agentId: agentIdValidator,

    email: emailValidator,

    phone: phoneValidator,

    address: addressValidator,

    password: passwordValidator,

    confirmPassword: passwordValidator,

    // CSP only (required): the opening float and the CSP limit. Cash
    // management and the float ledger start from these.
    cashInHand: moneyValidator("Cash in hand"),

    cashInAccount: moneyValidator("Cash in account"),

    cspLimit: moneyValidator("CSP limit"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })
  .superRefine((data, ctx) => {
    if (data.accountType !== "CSP") {
      return;
    }

    const required = [
      ["cashInHand", "Cash in hand is required."],
      ["cashInAccount", "Cash in account is required."],
      ["cspLimit", "CSP limit is required."],
    ] as const;

    for (const [field, message] of required) {
      if (data[field] === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message });
      }
    }

    const { cashInHand, cashInAccount, cspLimit } = data;

    // Compared in paise, so 0.1 + 0.2 = 0.3.
    if (
      cashInHand !== undefined &&
      cashInAccount !== undefined &&
      cspLimit !== undefined &&
      Math.round(cashInHand * 100) + Math.round(cashInAccount * 100) !==
        Math.round(cspLimit * 100)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["cspLimit"],
        message: "Cash in hand + cash in account must equal the CSP limit.",
      });
    }
  });

export type SignupDto = z.infer<typeof signupSchema>;
