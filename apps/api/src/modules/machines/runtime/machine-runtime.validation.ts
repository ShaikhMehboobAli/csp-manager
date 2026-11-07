import { z } from "zod";
import { ActivityEndReason } from "../../../generated/prisma/enums";

export const heartbeatSchema = z.object({
  machineCode: z.string().trim().min(1),

  // Optional when the request is signed with the device key (X-Signature).
  apiKey: z.string().trim().min(1).optional(),

  fingerprint: z.string().trim().min(1),

  watcherVersion: z.string().trim().min(1),

  osName: z.string().trim().optional(),

  osVersion: z.string().trim().optional(),

  deviceName: z.string().trim().optional(),

  ipAddress: z.string().trim().optional(),

  lastStartupAt: z.coerce.date().optional(),

  lastTransactionAt: z.coerce.date().optional(),
});

export const entitlementSchema = z.object({
  machineCode: z.string().trim().min(1),
  // Optional when the request is signed with the device key (X-Signature).
  apiKey: z.string().trim().min(1).optional(),
  fingerprint: z.string().trim().min(1),
});

const machineCredentials = {
  machineCode: z.string().trim().min(1),
  // Optional when the request is signed with the device key (X-Signature).
  apiKey: z.string().trim().min(1).optional(),
  fingerprint: z.string().trim().min(1),
};

export const activityStartSchema = z.object({
  ...machineCredentials,
  agentId: z.string().trim().min(1),
});

export const activityHeartbeatSchema = z.object({
  ...machineCredentials,
  activitySessionId: z.string().trim().min(1),
});

export const activityStopSchema = z.object({
  ...machineCredentials,
  activitySessionId: z.string().trim().min(1),
  reason: z.enum([
    ActivityEndReason.LOGOUT,
    ActivityEndReason.AUTO_LOGOUT,
    ActivityEndReason.APP_CLOSE,
  ]),
});

export const machineCashLoginOtpSchema = z.object({
  ...machineCredentials,
  agentId: z.string().trim().min(1, "Choose the agent."),
});

export const machineCashLoginVerifySchema = z.object({
  ...machineCredentials,
  agentId: z.string().trim().min(1, "Choose the agent."),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit OTP."),
});

export const machineEmailOtpSchema = z.object({
  ...machineCredentials,
  // A new / corrected email; omitted = the agent's saved email.
  email: z.string().trim().email("Invalid email address.").optional(),
});

export const machineEmailVerifySchema = z.object({
  ...machineCredentials,
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit OTP."),
});

export type HeartbeatRequest = z.infer<typeof heartbeatSchema>;
export type ActivityStartRequest = z.infer<typeof activityStartSchema>;
export type ActivityHeartbeatRequest = z.infer<typeof activityHeartbeatSchema>;
export type ActivityStopRequest = z.infer<typeof activityStopSchema>;
export type EntitlementRequest = z.infer<typeof entitlementSchema>;
