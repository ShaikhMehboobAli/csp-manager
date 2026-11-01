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
  });

export type SignupDto = z.infer<typeof signupSchema>;
