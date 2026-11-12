import { z } from "zod";

import { pushDeviceFields, requirePlatformWithToken } from "./push-device.validation";

import {
  agentIdValidator,
  otpValidator,
  passwordValidator,
} from "../../../core/validators/common.validator";

const passwordsMatch = (data: { password: string; confirmPassword: string }) =>
  data.password === data.confirmPassword;

const mismatch = { message: "Passwords do not match.", path: ["confirmPassword"] };

export const forgotPasswordSchema = z.object({
  agentId: agentIdValidator,
});

export const resetPasswordSchema = z
  .object({
    agentId: agentIdValidator,
    otp: otpValidator,
    password: passwordValidator,
    confirmPassword: passwordValidator,
  })
  .refine(passwordsMatch, mismatch);

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: "Current password is required." }).min(1, "Current password is required."),
    password: passwordValidator,
    confirmPassword: passwordValidator,
    // The new session replaces every old one: send the push token to keep pushes.
    ...pushDeviceFields,
  })
  .refine(passwordsMatch, mismatch)
  .superRefine(requirePlatformWithToken);

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
