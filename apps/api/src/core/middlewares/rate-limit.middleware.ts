import { Request } from "express";
import rateLimit, { Options } from "express-rate-limit";

/**
 * Request limits per process (in-memory store). With more than one API
 * instance, move to a shared store such as Redis (pre-production checklist).
 * A limited request gets 429 with the usual { success, message } body and
 * RateLimit-* headers telling the client when to retry.
 */
function limiter(
  windowMs: number,
  limit: number,
  keyGenerator?: Options["keyGenerator"],
) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    ...(keyGenerator && { keyGenerator }),
    message: {
      success: false,
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later.",
    },
  });
}

const MINUTE = 60 * 1000;

const ipKey = (req: Request) => req.ip ?? "unknown";

// Every /api/v1 request, per IP.
export const apiRateLimit = limiter(MINUTE, 600);

// Login, signup, OTP: slows down password and OTP guessing, per IP.
export const authRateLimit = limiter(15 * MINUTE, 20);

// Machine activation checks an activation password, per IP.
export const activationRateLimit = limiter(15 * MINUTE, 20);

// Desktop runtime calls (heartbeats, uploads), per machine. A backlog of
// receipts drains in sequential batches of 20, so this stays generous.
export const machineRuntimeRateLimit = limiter(MINUTE, 120, (req) => {
  const machineCode = req.body?.machineCode;

  return typeof machineCode === "string" && machineCode
    ? `machine:${machineCode}`
    : `ip:${ipKey(req)}`;
});

// Payment orders and verification, per signed-in user (after authMiddleware).
export const paymentRateLimit = limiter(MINUTE, 10, (req) =>
  req.user ? `user:${req.user.userId}` : `ip:${ipKey(req)}`,
);
