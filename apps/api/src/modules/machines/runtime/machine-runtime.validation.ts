import { z } from "zod";
import { ActivityEndReason } from "../../../generated/prisma/enums";

export const heartbeatSchema = z.object({
  machineCode: z.string().trim().min(1),

  apiKey: z.string().trim().min(1),

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
  apiKey: z.string().trim().min(1),
  fingerprint: z.string().trim().min(1),
});

const machineCredentials = {
  machineCode: z.string().trim().min(1),
  apiKey: z.string().trim().min(1),
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

export type HeartbeatRequest = z.infer<typeof heartbeatSchema>;
export type ActivityStartRequest = z.infer<typeof activityStartSchema>;
export type ActivityHeartbeatRequest = z.infer<typeof activityHeartbeatSchema>;
export type ActivityStopRequest = z.infer<typeof activityStopSchema>;
export type EntitlementRequest = z.infer<typeof entitlementSchema>;
