/**
 * Stable machine-readable codes sent as `code` next to `message`, so clients
 * (the desktop) don't depend on the English text. An AppError may carry its
 * own code; otherwise the message is matched here, then the status decides.
 */
const MESSAGE_CODES: [RegExp, string][] = [
  // Login, signup, OTP
  [/^Please verify your account first\./, "ACCOUNT_NOT_VERIFIED"],
  [/^Account already exists\./, "ACCOUNT_EXISTS"],
  [/^Invalid credentials\./, "INVALID_CREDENTIALS"],
  [/^Your account has been blocked\./, "ACCOUNT_BLOCKED"],
  [/^Your account has been suspended\./, "ACCOUNT_SUSPENDED"],
  [/^KO cannot create login account\./, "KO_NO_LOGIN"],
  [/^Invalid OTP\./, "OTP_INVALID"],
  [/^OTP has expired\./, "OTP_EXPIRED"],
  [/^Maximum OTP attempts exceeded\./, "OTP_ATTEMPTS_EXCEEDED"],
  [/^OTP not found\./, "OTP_NOT_FOUND"],
  [/^Please wait \d+ seconds? before asking for a new OTP\./, "OTP_RESEND_TOO_SOON"],
  [/^Too many OTPs sent\./, "OTP_RESEND_LIMIT"],
  [/^Token has expired\./, "TOKEN_EXPIRED"],
  [/^Invalid token\.|^Invalid authorization header\./, "TOKEN_INVALID"],
  [/^Authorization token is required\./, "TOKEN_REQUIRED"],
  [/^Invalid refresh token\.|^Refresh token has expired\./, "REFRESH_TOKEN_INVALID"],
  // Subscription
  [/^No subscription found\./, "SUBSCRIPTION_NONE"],
  [/^Your subscription has expired\./, "SUBSCRIPTION_EXPIRED"],
  [/^Your subscription has been suspended\./, "SUBSCRIPTION_SUSPENDED"],
  [/^Your subscription has been cancelled\./, "SUBSCRIPTION_CANCELLED"],
  [/^Your subscription is pending activation\./, "SUBSCRIPTION_PENDING"],
  [/^Your subscription has not started yet\./, "SUBSCRIPTION_NOT_STARTED"],
  [/^Your subscription does not include this feature\./, "PLAN_FEATURE_MISSING"],
  // Cash management
  [/^This plan doesn't include cash management\.|^Your subscription does not include cash management\./, "PLAN_NO_CASH_MANAGEMENT"],
  [/^Cash management isn't set up/, "CASH_NOT_SET_UP"],
  [/^This agent isn't part of a CSP\./, "NOT_PART_OF_CSP"],
  [/^No agent is currently assigned to this machine\./, "NO_AGENT_ASSIGNED"],
  [/^(Not enough cash in hand|That's more than your cash in hand)/, "INSUFFICIENT_CASH_IN_HAND"],
  [/^(Not enough cash in account|That's more than the cash in account)/, "INSUFFICIENT_CASH_IN_ACCOUNT"],
  [/^Not enough cash left in bank/, "INSUFFICIENT_LEFT_IN_BANK"],
  [/^Not enough .* to cancel it/, "INSUFFICIENT_CASH_TO_CANCEL"],
  [/denomination total|^The notes' total|must equal the notes counted|^Both sides must be equal/i, "DENOMINATION_MISMATCH"],
  [/^Cash denomination is required/, "DENOMINATION_REQUIRED"],
  [/^Not enough ₹\d+ (notes|coins) in the drawer/, "DRAWER_TOO_FEW_NOTES"],
  [/^This agent already has an open settlement\./, "SETTLEMENT_ALREADY_OPEN"],
  [/^This settlement step is already approved\./, "STEP_ALREADY_APPROVED"],
  [/^This settlement step is already cancelled\./, "STEP_ALREADY_CANCELLED"],
  [/^Settlement not found\./, "SETTLEMENT_NOT_FOUND"],
  [/^Today is already closed\./, "DAY_ALREADY_CLOSED"],
  [/^A cash change request is already pending/, "REQUEST_ALREADY_PENDING"],
  [/^This request has already been reviewed\./, "REQUEST_ALREADY_REVIEWED"],
  [/^This due is already settled or cancelled\./, "DUE_NOT_OPEN"],
  [/^Due not found\./, "DUE_NOT_FOUND"],
  [/^This receipt already has an open due\./, "RECEIPT_DUE_ALREADY_OPEN"],
  [/^Receipt not found for this agent\./, "RECEIPT_NOT_FOUND"],
  [/^That label isn't available any more\./, "LABEL_NOT_AVAILABLE"],
  [/^That label can't be used for cash/, "LABEL_DIRECTION_NOT_ALLOWED"],
  [/^A label with this name already exists\./, "LABEL_NAME_TAKEN"],
  [/^This task is from your CSP\.|^This task is the agent's own\./, "TASK_FROM_OTHER_SIDE"],
  [/^That task isn't there any more\./, "TASK_NOT_FOUND"],
  [/^Duplicate request: the same Idempotency-Key/, "IDEMPOTENCY_KEY_REUSED"],
  [/^This request is still being processed/, "IDEMPOTENCY_IN_PROGRESS"],
  // Machine authentication (desktop doc section H)
  [/^Machine not found\./, "MACHINE_NOT_FOUND"],
  [/^Machine has no active activation\./, "NO_ACTIVE_ACTIVATION"],
  [/^Signed request(s are)? required/, "SIGNATURE_REQUIRED"],
  [/^Invalid request signature\./, "SIGNATURE_INVALID"],
  [/^Request timestamp is too old/, "SIGNATURE_CLOCK_SKEW"],
  [/^Request has already been used/, "SIGNATURE_REPLAYED"],
  [/^Machine API key is required\./, "API_KEY_REQUIRED"],
  [/^(Machine API key not found|Invalid API key)\./, "API_KEY_INVALID"],
  [/^Machine fingerprint mismatch\./, "FINGERPRINT_MISMATCH"],
  [/^Machine credentials in the headers and the body don't match\./, "CREDENTIALS_MISMATCH"],
  [/^Machine (is not active|is inactive)\./, "MACHINE_INACTIVE"],
  [/^Machine has been deleted\./, "MACHINE_DELETED"],
  [/^Activation is inactive\./, "ACTIVATION_INACTIVE"],
  [/^Activation has expired\./, "ACTIVATION_EXPIRED"],
  [/^Re-activation required|re-activate this PC/i, "REACTIVATION_REQUIRED"],
  [/^Subscription (is not active|is inactive or expired)\./, "SUBSCRIPTION_INACTIVE"],
  [/^Subscription has expired\./, "SUBSCRIPTION_EXPIRED"],
  [/^Receipt Watcher has been disabled/, "WATCHER_DISABLED"],
  [/^Receipt watcher is not allowed/, "WATCHER_NOT_ALLOWED"],
  [/^No active machine session found\./, "NO_ACTIVE_SESSION"],
  [/^The assigned agent is not valid\./, "AGENT_NOT_VALID"],
];

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
};

/** The thrown code, else the message's, else `fallback`, else the status's. */
export function errorCodeOf(message: string, status: number, explicit?: string, fallback?: string) {
  return (
    explicit ??
    MESSAGE_CODES.find(([pattern]) => pattern.test(message))?.[1] ??
    fallback ??
    STATUS_CODES[status] ??
    "ERROR"
  );
}

/** Codes for a skipped receipt's `reason` in upload answers. */
export function skipReasonCode(reason: string) {
  if (reason === "Receipt already exists.") return "RECEIPT_ALREADY_EXISTS";
  if (reason === "Duplicate receipt in request.") return "DUPLICATE_IN_REQUEST";
  if (reason.startsWith("Receipt is older than")) return "OLDER_THAN_RETENTION";

  return "INVALID_RECEIPT";
}
