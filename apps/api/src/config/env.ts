import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Resolve potential .env file locations (apps/api/.env, project root .env, or process.cwd())
const localEnvPath = path.resolve(__dirname, "../../.env");
const rootEnvPath = path.resolve(__dirname, "../../../../.env");
const cwdEnvPath = path.resolve(process.cwd(), ".env");
const cwdApiEnvPath = path.resolve(process.cwd(), "apps/api/.env");

// Load repository root .env first (if present)
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
}
if (fs.existsSync(cwdEnvPath) && cwdEnvPath !== rootEnvPath) {
  dotenv.config({ path: cwdEnvPath, override: true });
}
if (fs.existsSync(cwdApiEnvPath) && cwdApiEnvPath !== localEnvPath) {
  dotenv.config({ path: cwdApiEnvPath, override: true });
}
// apps/api/.env takes highest precedence
if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath, override: true });
}

// Fallback to standard dotenv resolution
dotenv.config({ override: true });

export const env = {
  port: Number(process.env.PORT) || 3000,

  nodeEnv: process.env.NODE_ENV || "development",

  apiPrefix: process.env.API_PREFIX || "/api/v1",

  databaseUrl: process.env.DATABASE_URL || "",

  logLevel: process.env.LOG_LEVEL || "debug",

  jwtSecret: process.env.JWT_SECRET || "",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "",
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",

  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || "",

  // Number of reverse-proxy hops in front of the API; 0 = none.
  trustProxy: Number(process.env.TRUST_PROXY) || 0,

  // true: every desktop call must be signed with a device key; machines
  // without one must re-activate. Keep false until the desktop release ships.
  machineSignatureRequired: process.env.MACHINE_SIGNATURE_REQUIRED === "true",

  // Firebase push (FCM). JSON wins over the file path; neither = push off.
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "",

  // Email (Resend). No key = emails are only logged (outside production).
  resendApiKey: process.env.RESEND_API_KEY || "",
  // A sender on a domain verified in Resend; onboarding@resend.dev only
  // delivers to the Resend account's own email.
  emailFrom: process.env.EMAIL_FROM || "CSP Manager <onboarding@resend.dev>",
  emailReplyTo: process.env.EMAIL_REPLY_TO || "",

  // Razorpay. Key id + secret set = real payments; unset = dev stand-in
  // (refused in production). The webhook secret is the one set on the
  // webhook in the Razorpay Dashboard (not the key secret).
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  // Most one UPI AutoPay debit may take, in rupees (₹15,000 = no extra
  // approval per debit for most merchant categories).
  razorpayMandateMaxAmount: Number(process.env.RAZORPAY_MANDATE_MAX_AMOUNT) || 15000,
  // true = a CSP's monthly purchase is a UPI AutoPay order (pay + approve the
  // mandate in one step). Needs Razorpay Recurring Payments enabled on the
  // account; while it isn't, Checkout shows "No appropriate payment method
  // found", so it stays off and purchases are normal one-time payments.
  razorpayAutopayOnPurchase: process.env.RAZORPAY_AUTOPAY_ON_PURCHASE === "true",
};
