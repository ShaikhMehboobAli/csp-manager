import { z } from "zod";

import {
  accountTypeValidator,
  addressValidator,
  agentIdValidator,
  emailValidator,
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
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignupDto = z.infer<typeof signupSchema>;
