import { z } from "zod";

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

export type HeartbeatRequest = z.infer<typeof heartbeatSchema>;
export type EntitlementRequest = z.infer<typeof entitlementSchema>;
