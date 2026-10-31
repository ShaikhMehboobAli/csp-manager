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
    // ECDSA P-256 public key (SPKI, PEM or base64 DER) of a device key created
    // on this PC. When sent, every later request must be signed with it.
    devicePublicKey: z.string().trim().min(1).max(2000).optional(),
  }),
});
