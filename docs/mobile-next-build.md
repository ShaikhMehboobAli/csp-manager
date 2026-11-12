# Mobile app — what to build next (handoff, 2026-11-12)

**For:** the React Native team. **Backend:** ready on the dev server for everything below (mobile KT rev 31–34).
**Full contracts:** `docs/mobile-app-kt.md` (section numbers in brackets). This page is the build list; the KT has every field.

Every error is `{ success: false, code, message, details? }`. Show `message`; branch on `code`; `details` (new) carries extras such as `retryAfterSeconds`.

---

## Build order

| # | Feature | Why first | KT |
|---|---|---|---|
| 1 | Push token on login / refresh / logout | without it no push ever reaches the phone | §5.2, §19.4 R23 |
| 2 | Firebase push setup + tap routing | every notification below arrives as a push | §19.4 R23, §13D |
| 3 | Razorpay Checkout (buy / upgrade) | real payments are live in test mode | §6D.1 |
| 4 | UPI AutoPay screens (set up, renewal states) | CSP plans renew by AutoPay | §6D.2, §6A |
| 5 | Email code timers and email errors | signup, forgot password, email change | §5.2 "Email codes, resend timer and limits" |
| 6 | Assign code: onboarding email result | the agent now gets its code by email | §8 |
| 7 | Profile, BC unlink, app config, email code to agent | app-team asks R20–R24 | §19.4 |
| 8 | Smaller changes (metrics read-only, new receipt fields, removed APIs) | | below |

---

## 1. Push token: send it with login, refresh and change-password

There are **no separate device calls** (`POST` / `DELETE /notifications/devices` were removed; they answer 404).

| Call | Add to the body | Notes |
|---|---|---|
| `POST /auth/login` | `pushToken`, `platform` (`"android"` \| `"ios"`), `appVersion` | get the token with `messaging().getToken()` first; if permission is denied or Firebase fails, log in without these three fields |
| `POST /auth/refresh` (every ≤ 15 min) | the same three | this is how a rotated token (`onTokenRefresh`) and a later permission grant reach the server; without `pushToken` the saved one stays |
| `POST /auth/change-password` | the same three | every old session ends; send the token so this phone keeps getting pushes |
| `POST /auth/logout` `{ refreshToken }` | nothing | the server removes this session's token; then call `messaging().deleteToken()` |

- `pushToken` without `platform` → 400 `Send the platform (android or ios) with the push token.`
- Pushes go only to **live sessions**: after logout, a password change on another phone, block / suspend, or 7 days unused, that phone gets nothing more. One phone = the last login.

## 2. Firebase push setup and what to do on tap

**Setup** (§19.4 R23):
- Packages: `@react-native-firebase/app`, `@react-native-firebase/messaging` (FCM tokens, **not** Expo push tokens).
- Config files from the backend owner: `google-services.json` (Android), `GoogleService-Info.plist` (iOS). The package name / bundle id must match the Firebase project `csp-manager-e3d91`.
- Permission: Android 13+ `POST_NOTIFICATIONS`; iOS `requestPermission()`. iOS pushes start once the owner uploads the APNs key.
- Create an Android notification channel with id **`default`** (the server sends `channelId: "default"`, high priority, default sound).

**Message:** `notification: { title, body }` + `data` (all values are **strings**): `notificationId`, `kind`, and each key of the notification's `data` (objects JSON-encoded).

**Handling:**
- Tap (`onNotificationOpenedApp`, `getInitialNotification`): open the screen for `kind` (table below), then `POST /notifications/:notificationId/read`.
- Foreground (`onMessage`): Android shows nothing by itself; refresh the bell badge (`GET /notifications?unreadOnly=true&limit=1`) or show your own banner.
- A push can arrive a second or two after the action (the server sends it once the change is saved).

**Notification kinds and where to go** (full table with `data` keys: §13D):

| Group (setting) | `kind` | Open |
|---|---|---|
| plan (always on) | `SUBSCRIPTION_RENEWED`, `SUBSCRIPTION_RENEWAL_FAILED`, `SUBSCRIPTION_LAPSED`, `SUBSCRIPTION_CANCELLED`, `MANDATE_REVOKED`, `MANDATE_REPLACED`, `TRIAL_STARTED`, `TRIAL_ENDING`, `TRIAL_EXTENDED`, `GENERAL` | Subscription screen (refetch `/subscriptions/access`); `GENERAL` nothing |
| cash | `CASH_ACTIVATION_DIFFERENCE`, `CASH_REQUEST_RAISED`, `CASH_DAY_CLOSE_DIFFERENCE`, `CASH_DAY_NOT_CLOSED` | Cash → that agent (`data.agentId`); `CASH_REQUEST_RAISED` → the request to approve / reject |
| settlements | `CASH_SETTLEMENT_STARTED`, `CASH_SETTLEMENT_COMPLETED`, `CASH_SETTLEMENT_CANCELLED` | Cash → that KO → settlements |
| machines | `MACHINE_OFFLINE`, `ACTIVATION_REVOKED` | Machines → that PC / Activations → that code |
| requests | `ACTIVATION_REVOKE_APPROVED` / `_REJECTED`, `BC_LINK_APPROVED` / `_REJECTED`, `BC_LINKED`, `BC_UNLINKED`, `RECEIPT_REPORT_RESOLVED` / `_REJECTED` | the matching list / item |

- **Settings screen:** `GET /notifications/preferences` → `{ plan: true, cash, settlements, machines, requests, locked: ["plan"] }`; `PATCH` any of `cash`, `settlements`, `machines`, `requests`. `plan: false` → 400 `PREFERENCE_LOCKED`. A switched-off group still appears in the in-app list; only the push is skipped.
- **Rules worth showing in help text:**
  - "PC offline" fires after 1 hour without a heartbeat **within the working day** (team settings start–closing time, else 09:00–19:00).
  - "Day not closed" fires 30 minutes before the closing time (18:00 when none is set), once per agent per day.
  - Only KO actions notify the CSP; the CSP's own desktop actions don't.

## 3. Razorpay Checkout (buy a plan, upgrade, BC plans)

Package: **`react-native-razorpay`** (Standard Checkout). Keep it behind one function `payForPlan(planId, billingCycle, machineCount?)`.

1. `POST /payments/create-order` `{ planId, billingCycle, machineCount? }` + header `Idempotency-Key` → `data.checkout`:
   ```json
   { "keyId": "rzp_test_…", "orderId": "order_…", "amount": 64900, "currency": "INR",
     "name": "CSP Manager", "description": "CSP Complete (PAY…)",
     "recurring": "1", "customerId": "cust_…",
     "prefill": { "name": "…", "email": "…", "contact": "…" }, "notes": { "paymentId": "…" } }
   ```
   **For now (2026-11-12) every order is a normal one-time payment (`recurring: null`)**: Razorpay Recurring Payments isn't enabled on the account yet (an AutoPay order shows "No appropriate payment method found"). Only pass `recurring` / `customer_id` to Checkout when the server sends them.
   `amount` is in **paise**. `recurring: "1"` + `customerId` = a CSP's **monthly purchase**: it is **UPI only** and also approves UPI AutoPay; pass `recurring` and `customer_id` to Checkout. `recurring: null` = any method. `checkout: null` = a dev server without Razorpay (don't ship that flow).
2. Open Checkout: `{ key: keyId, order_id: orderId, amount, currency, name, description, prefill, notes, …(recurring && { recurring, customer_id: customerId }) }`.
3. On success → `POST /payments/verify` `{ paymentId, razorpayOrderId, razorpayPaymentId, razorpaySignature }`:

| Answer | App |
|---|---|
| 200 `data: { paymentId, subscriptionId }` | done: refetch `/subscriptions/access`, `/activations` |
| 200 `data.status: "PROCESSING"` | "Confirming payment…": poll `GET /payments/:paymentId` every 5 s (up to ~2 min) until `status: "SUCCESS"` |
| 400 `PAYMENT_SIGNATURE_INVALID`, `PAYMENT_AMOUNT_MISMATCH`, `PAYMENT_ORDER_MISMATCH` | "Payment couldn't be verified"; don't retry the same values; show support contacts (`/app/config`) |
| 400 `PAYMENT_FAILED` | let the user pay again (call `create-order` again: it returns the same pending order) |
| 502 `PAYMENT_GATEWAY_ERROR` | retry `verify` after a few seconds (safe) |
| 409 `RENEWAL_IN_PROGRESS` (on create-order) | "Your renewal is being charged; try again later" |

- **Checkout closed / bank declined:** nothing to call; the order stays payable.
- **App killed after paying:** the server completes the payment from Razorpay's webhook; on next open refetch `/subscriptions/access`.
- Same `razorpayPaymentId` again after success → 200 `Payment already verified.`
- **Test mode:** UPI ID `success@razorpay` (succeeds) / `failure@razorpay` (fails).

## 4. UPI AutoPay (CSP monthly renewal)

- **Set up:** with the CSP's monthly purchase (step 3). Becomes ACTIVE when the payment is captured (seconds).
- **"Set up AutoPay" button** (Subscription screen) when there's no ACTIVE mandate (removed in the UPI app, price changed, purchase above ₹15,000, or a gateway hiccup): `POST /payments/mandates/setup` → `data: { mandateId, status, authUrl, amount, maxAmount }`.
  - `status: "ACTIVE"` → "AutoPay is set up".
  - `authUrl` → open it (in-app browser); the CSP approves in the UPI app (Razorpay charges ₹1 and refunds it).
  - `authUrl: null` and not active → "Try again in a minute".
  - 400 `NO_RENEWING_PLAN` → no running plan that renews.
- **Renewal timing** (owner decision): the charge starts **2 days before `endDate`**; Razorpay notifies the customer, debits about a day later and retries itself. The plan works until `endDate`.
  - Success → `SUBSCRIPTION_RENEWED` (new `endDate`).
  - Final failure before `endDate` → `SUBSCRIPTION_RENEWAL_FAILED` with `data.autoRenew: false`, `endsAt`: show "Your plan works until <endsAt> and then stops. Renew or take a new plan."
  - No success by `endDate` → blocked from `endDate` (no grace); a late successful debit brings the plan back.
  - Mandate removed / paused / rejected → `MANDATE_REVOKED` → show "Set up AutoPay".
- One debit is at most **₹15,000** (`maxAmount`); above that a new approval is needed.

## 5. Email codes: timer, limits and email errors

Every call that emails a code returns `resendAvailableAt` + `resendInSeconds` (60):

| Call | Success `data` adds |
|---|---|
| `POST /auth/signup` | `resendAvailableAt`, `resendInSeconds` |
| `POST /auth/resend-otp` | `expiresAt`, `resendAvailableAt`, `resendInSeconds` |
| `POST /auth/forgot-password` | `resendAvailableAt`, `resendInSeconds` (same answer for every ID) |
| `PATCH /auth/me` with a new email (202) | `pendingEmail`, `expiresAt`, `resendAvailableAt`, `resendInSeconds` |

- **Countdown:** disable "Send a new code" and count down from `resendInSeconds` (trust the server time).
- **Too soon / too many:** 409 `OTP_RESEND_TOO_SOON` / `OTP_RESEND_LIMIT` with `details: { retryAfterSeconds, resendAvailableAt }` → restart the countdown from `retryAfterSeconds` (up to an hour for the limit).
- **Central email limit:** 429 `EMAIL_RATE_LIMITED` (`details.retryAfterSeconds`): the same kind of email at most every 30 s, 10 emails per address per hour.
- **Provider down:** 503 `EMAIL_SEND_FAILED` / `EMAIL_NOT_CONFIGURED` / `EMAIL_DAILY_LIMIT` → "We couldn't send the email right now"; keep the user on the screen.
- Emails come from **CSP Manager \<no-reply@cspmanager.in\>** (tell users to check spam the first time).

## 6. Assigning a code now emails the agent

`POST /activations/assign` → `data: { activationCode, activationPassword, email }`:

| `data.email` | App |
|---|---|
| `{ sent: true, sentTo: "si*****@gmail.com" }` | toast with `message` ("…emailed to si*****@gmail.com"); the code + password modal may still show Copy / Share |
| `{ sent: false, reason: "NO_EMAIL", message }` | show the modal (share it yourself) + "Add an email to send it" → after adding: **Email to agent** |
| `{ sent: false, reason: "RATE_LIMITED" \| "SEND_FAILED", message }` | show the modal + `email.message`; offer **Email to agent** later |

**Email to agent** = `POST /activations/:activationId/send` `{ to?: "agent" | "me" }` (makes a new password; 5 per hour per code; 429 `RATE_LIMITED`, 400 `AGENT_HAS_NO_EMAIL`, 503 email errors as in 5).

## 7. App-team asks R20–R24 (built in rev 31)

Full request / response / errors: §19.4 "Backend status (rev 31)".

| Ask | Calls | Notes |
|---|---|---|
| R20 Profile | `GET /auth/me`, `PATCH /auth/me` `{ name?, phone?, address?, email? }`, `POST /auth/me/email/verify` `{ otp }` | a new email → 202 + code (timer: 5); 409 `EMAIL_TAKEN` |
| R21 BC unlinks a CSP | `POST /bc-links/csps/:cspAgentId/unlink` `{ reason? }` | only CSPs linked by request (400 `UNLINK_NOT_ALLOWED` for BC-created ones); the CSP gets `BC_UNLINKED` |
| R22 App config | `GET /app/config` (public, cache 1 h) | `updateRequired` → full-screen "Please update"; `updateAvailable` → banner; `support.*` for Help |
| R23 Push | see 1–2 | device calls removed in rev 32 |
| R24 Email code to agent | `POST /activations/:activationId/send` | see 6 |

Also from rev 31 (§19.5): receipts carry `source` (`AUTOMATION` / `MANUAL`) and `denominationPending` ("Count needed"); the cash pool shows `agents[].pendingCounts`; ledger type `RECEIPT_COUNT` ("Notes counted"); KO form field **SBI kiosk user ID** (`sbiUserId`, optional, unique: 409 `SBI_USER_ID_TAKEN`); day closes show `accountDifference`; "Send PC log to support" (`POST /machines/:machineId/diagnostics`, last 3 days only: 400 `DIAGNOSTICS_RANGE_TOO_OLD`).

## 8. Smaller changes

- **Metrics are read-only in the app:** `POST` / `PATCH /metrics/values` are super-admin only (a BC gets 403). Remove the BC entry form; keep the list (`GET /metrics`, `GET /metrics/values`).
- **Removed:** `POST /notifications/devices`, `DELETE /notifications/devices/:token` (use login / refresh / logout).
- **Team settings:** tell the CSP that start / closing time also drive "PC offline" (only in those hours) and the day-close reminder (30 min before closing).

## Test checklist (dev server)

- [ ] Login with `pushToken` → a Firebase test message to that token arrives; logout → it no longer does.
- [ ] Super admin extends a trial → `TRIAL_EXTENDED` push opens the Subscription screen.
- [ ] Buy a monthly CSP plan with `success@razorpay` → subscription active, `GET /subscriptions/access` shows the mandate ACTIVE.
- [ ] Buy with `failure@razorpay` → order stays payable, retry works.
- [ ] Kill the app right after paying → reopen → plan is active (webhook).
- [ ] Forgot password twice quickly → countdown restarts from `retryAfterSeconds`.
- [ ] Assign a code to a KO with / without email → both `data.email` cases.
