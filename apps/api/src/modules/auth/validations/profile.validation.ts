import { z } from "zod";

import {
  addressValidator,
  emailValidator,
  nameValidator,
  phoneValidator,
} from "../../../core/validators/common.validator";

export const updateProfileSchema = z
  .object({
    name: nameValidator.optional(),
    phone: phoneValidator.optional(),
    address: addressValidator.optional(),
    email: emailValidator.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), "Nothing to change.");

export const verifyProfileEmailSchema = z.object({
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must be 6 digits."),
});
