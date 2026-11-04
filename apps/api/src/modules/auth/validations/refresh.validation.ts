import { z } from "zod";

export const refreshSchema = z.object({
  refreshToken: z.string({ error: "Refresh token is required." }).trim().min(1, "Refresh token is required."),
});

export const resendOtpSchema = z.object({
  agentId: z.string({ error: "Agent ID is required." }).trim().min(1, "Agent ID is required."),
});

export type RefreshDto = z.infer<typeof refreshSchema>;
export type ResendOtpDto = z.infer<typeof resendOtpSchema>;
