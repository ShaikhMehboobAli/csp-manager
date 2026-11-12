import { z } from "zod";

import { pushDeviceFields, requirePlatformWithToken } from "./push-device.validation";

const refreshToken = z.string({ error: "Refresh token is required." }).trim().min(1, "Refresh token is required.");

/** Refresh can carry the phone's current push token (Firebase rotates it). */
export const refreshSchema = z.object({ refreshToken, ...pushDeviceFields }).superRefine(requirePlatformWithToken);

/** Logout removes the session's push token; no token needed. */
export const logoutSchema = z.object({ refreshToken });

export const resendOtpSchema = z.object({
  agentId: z.string({ error: "Agent ID is required." }).trim().min(1, "Agent ID is required."),
});

export type RefreshDto = z.infer<typeof refreshSchema>;
export type ResendOtpDto = z.infer<typeof resendOtpSchema>;
