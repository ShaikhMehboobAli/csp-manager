import { z } from "zod";

export const activateMachineSchema = z.object({
  agentId: z.string().trim().min(1),

  activationCode: z.string().trim().min(1),

  activationPassword: z.string().trim().min(1),

  machine: z.object({
    fingerprint: z.string().trim().min(1),

    machineName: z.string().optional(),

    watcherVersion: z.string().trim().min(1),

    osName: z.string().optional(),

    osVersion: z.string().optional(),

    deviceName: z.string().optional(),

    ipAddress: z.string().optional(),
  }),
});
