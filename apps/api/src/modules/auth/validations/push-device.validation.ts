import { z } from "zod";

/**
 * Optional push token fields on login, refresh and change-password (mobile
 * app only). The token is tied to the login session: logout or a revoked
 * session stops pushes to it.
 */
export const pushDeviceFields = {
  pushToken: z.string().trim().min(10, "Send the push token.").max(4096).optional(),
  platform: z.enum(["android", "ios"], { message: "Platform must be android or ios." }).optional(),
  appVersion: z.string().trim().max(30).optional(),
};

export function requirePlatformWithToken(data: { pushToken?: string; platform?: string }, ctx: z.RefinementCtx) {
  if (data.pushToken && !data.platform) {
    ctx.addIssue({ code: "custom", path: ["platform"], message: "Send the platform (android or ios) with the push token." });
  }
}

export type PushDeviceInput = { pushToken?: string; platform?: "android" | "ios"; appVersion?: string };
