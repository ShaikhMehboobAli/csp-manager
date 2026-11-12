import fs from "fs";

import { cert, getApps, initializeApp, App, ServiceAccount } from "firebase-admin/app";
import { getMessaging, MulticastMessage } from "firebase-admin/messaging";

import { env } from "../../config/env";
import { Logger } from "../utils/logger";

/**
 * Firebase Cloud Messaging (Android, and iOS through APNs in FCM).
 *
 * Credentials, first one set wins:
 *  - FIREBASE_SERVICE_ACCOUNT_JSON: the whole service-account JSON (production secret store)
 *  - FIREBASE_SERVICE_ACCOUNT_PATH: a path to the JSON file (local dev; never commit it)
 * Neither set → push is off (logged once), the app still works.
 */

let app: App | null | undefined;

function loadServiceAccount(): ServiceAccount | null {
  const raw = env.firebaseServiceAccountJson
    || (env.firebaseServiceAccountPath ? fs.readFileSync(env.firebaseServiceAccountPath, "utf8") : "");

  if (!raw) {
    return null;
  }

  const json = JSON.parse(raw);

  return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key };
}

function getApp(): App | null {
  if (app !== undefined) {
    return app;
  }

  try {
    const account = loadServiceAccount();

    if (!account) {
      Logger.warn("[FCM] No Firebase service account set; push notifications are off.");
      app = null;

      return app;
    }

    app = getApps().find((a) => a.name === "csp-push") ?? initializeApp({ credential: cert(account) }, "csp-push");
    Logger.info(`[FCM] Ready for project ${account.projectId}.`);
  } catch (error) {
    Logger.error(`[FCM] Could not load the Firebase service account: ${(error as Error).message}`);
    app = null;
  }

  return app;
}

export function isFcmEnabled() {
  return getApp() !== null;
}

/** Error codes that mean the token will never work again: delete it. */
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export type FcmPayload = {
  title: string;
  body: string;
  /** FCM data values must be strings. */
  data: Record<string, string>;
};

/**
 * Sends one message to up to 500 tokens. Returns the tokens FCM says are dead.
 * Throws only on a whole-request failure (network, credentials).
 */
export async function sendToTokens(tokens: string[], payload: FcmPayload): Promise<{ sent: number; deadTokens: string[] }> {
  const fcm = getApp();

  if (!fcm || tokens.length === 0) {
    return { sent: 0, deadTokens: [] };
  }

  const message: MulticastMessage = {
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
    android: { priority: "high", notification: { channelId: "default", sound: "default" } },
    apns: { payload: { aps: { sound: "default" } } },
  };

  const result = await getMessaging(fcm).sendEachForMulticast(message);
  const deadTokens: string[] = [];

  result.responses.forEach((response, index) => {
    if (!response.success && response.error && DEAD_TOKEN_CODES.has(response.error.code)) {
      deadTokens.push(tokens[index]);
    } else if (!response.success) {
      Logger.warn(`[FCM] Send failed: ${response.error?.code} ${response.error?.message}`);
    }
  });

  return { sent: result.successCount, deadTokens };
}
