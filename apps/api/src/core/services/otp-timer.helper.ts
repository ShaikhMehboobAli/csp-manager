import { AppError } from "../errors/AppError";

/** Every emailed code: one per minute per purpose, at most 5 an hour. */
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_PER_HOUR = 5;
export const OTP_WINDOW_MS = 60 * 60 * 1000;

/** Fields every "code sent" answer carries, so apps can show the resend countdown. */
export function resendTimer(sentAt = Date.now()) {
  const resendAvailableAt = new Date(sentAt + OTP_RESEND_SECONDS * 1000);

  return { resendAvailableAt, resendInSeconds: Math.max(0, Math.ceil((resendAvailableAt.getTime() - Date.now()) / 1000)) };
}

/** Asked again before the minute is up (code OTP_RESEND_TOO_SOON). */
export function resendTooSoonError(lastSentAt: Date, status = 409) {
  const resendAvailableAt = new Date(lastSentAt.getTime() + OTP_RESEND_SECONDS * 1000);
  const wait = Math.max(1, Math.ceil((resendAvailableAt.getTime() - Date.now()) / 1000));

  return new AppError(
    `Please wait ${wait} second${wait === 1 ? "" : "s"} before asking for a new OTP.`,
    status,
    "OTP_RESEND_TOO_SOON",
    { retryAfterSeconds: wait, resendAvailableAt },
  );
}

/** 5 codes in the hour already (code OTP_RESEND_LIMIT); `windowStart` = first send of the hour. */
export function resendLimitError(windowStart: Date, status = 409) {
  const resendAvailableAt = new Date(windowStart.getTime() + OTP_WINDOW_MS);
  const wait = Math.max(60, Math.ceil((resendAvailableAt.getTime() - Date.now()) / 1000));

  return new AppError("Too many OTPs sent. Please try again in an hour.", status, "OTP_RESEND_LIMIT", {
    retryAfterSeconds: wait,
    resendAvailableAt,
  });
}
