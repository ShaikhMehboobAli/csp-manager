import { z } from "zod";

import {
  agentIdValidator,
  otpValidator,
} from "../../../core/validators/common.validator";

export const verifyOtpSchema = z.object({
  agentId: agentIdValidator,
  otp: otpValidator,
});

export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
