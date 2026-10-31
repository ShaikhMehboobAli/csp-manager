import dotenv from "dotenv";

dotenv.config();

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
};
