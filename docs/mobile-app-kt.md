# CSP Manager Mobile App (React Native) — KT

**Audience:** the React Native team building the CSP Manager mobile app for **BC** and **CSP** users.
**Not covered here:** the Super Admin console (React / Next.js) → `docs/admin-web-kt.md`; the Windows desktop app → `docs/desktop-integration-changes.md`.
**Backend source of truth:** `csp-manager/apps/api` (Express + Prisma + PostgreSQL).
**Last updated:** 2026-11-02 (rev 15)

> Describes the backend once PRs #3–#8 are merged into `development`. Where an older build behaves differently it says so.

---

## Contents

1. Product in one page
2. App architecture (recommended stack)
3. API conventions (client, errors, auth header)
4. Roles and navigation
5. Auth: signup, OTP, login, session
6. Plans, subscription and payment
7. Paywall and feature gating
8. Activations (machine codes for the desktop app)
9. Agents: CSPs and KOs
10. BC ₹799: link existing CSPs (with their KOs)
11. Dashboard
12. Machines
13. Transactions (receipts)
13A. Cash management (CSP + KOs)
14. Reports
15. Metrics (manual entries)
16. CSP visits (photo upload)
17. File downloads (Excel)
18. Dates, money and formatting
19. Known backend gaps
20. Changelog

---

## 1. Product in one page

- **CSP** (Customer Service Point) runs SBI banking transactions on a Windows PC. The **desktop app** (ReceiptWatcher) automates the SBI workflow and uploads every confirmed transaction to the backend.
- **KO** is an operator under a CSP. A KO has **no login**: the CSP manages KOs, and a KO's machine and transactions roll up to the CSP.
- **BC** (Business Correspondent) oversees many CSPs and sees their transactions, machines, float/cash and reports.
- **Mobile app (this doc):** CSPs and BCs sign up, buy a plan, generate/assign machine activation codes, and monitor dashboards, machines, transactions and reports.
- **Super Admin** (separate web console) approves BC↔CSP link requests, sets plan prices and manages metric definitions.

Plans (prices come from the API; these are the current values):

| Who | Plan `code` | Price | Machines | Features |
|---|---|---|---|---|
| CSP | `CSP_AUTOMATION` | ₹250 per machine/month | chosen at checkout (1–100) | `DESKTOP_AUTOMATION`, `RECEIPT_SYNC` |
| CSP | `CSP_AUTOMATION_CASH_MANAGEMENT` | ₹450 per machine/month | chosen at checkout | + `CASH_MANAGEMENT` |
| CSP | `CSP_COMPLETE` | ₹550 per machine/month | chosen at checkout | + `CASH_MANAGEMENT`, `MOBILE_TRACKING` |
| BC | `BC_BASIC` | ₹199/month | 1 | desktop features + `CASH_MANAGEMENT`, `MOBILE_TRACKING` |
| BC | `BC_PRO` | ₹399/month | 5 | same |
| BC | `BC_CSP_LINK` | ₹799/month, ₹4794/6 months, ₹9588/year | **0** | `CSP_LINKING`, `CASH_MANAGEMENT` |

Machine plans give activation codes (one per machine) that the BC/CSP assigns to an agent and types into the desktop app. **Only a CSP buys CSP plans** (KOs have no login): the CSP picks how many machines it needs (its own PC plus its KOs' PCs), pays price × machines, and assigns one code per PC. BC plans have a fixed machine count. `BC_CSP_LINK` gives no machines; instead the BC links CSPs that already pay for their own plan (section 10).

## 2. App architecture (recommended stack)

| Concern | Recommendation | Why |
|---|---|---|
| App shell | Expo (SDK ≥ 51) with a dev client, or bare RN ≥ 0.74 | needs secure storage, file system, image picker, sharing |
| Navigation | React Navigation: `AuthStack`, `CspTabs`, `BcTabs`, chosen by `user.role` after login | role-specific apps in one binary |
| Server state | TanStack Query (`@tanstack/react-query`) | caching, refetch on focus, invalidation after mutations |
| HTTP | one `axios` instance (`baseURL = API_BASE_URL + "/api/v1"`, 15 s timeout) | interceptors for token and errors |
| Tokens | `expo-secure-store` / `react-native-keychain` | **never** AsyncStorage |
| Forms | `react-hook-form` + `zod` (mirror the server rules in this doc) | instant field errors; the server still validates |
| Dates | `dayjs` with `utc` + `timezone` plugins, `Asia/Kolkata` | see section 18 |
| Files | `expo-file-system` + `expo-sharing` | Excel exports (section 17) |
| Images | `expo-image-picker` + `expo-image-manipulator` | visit photos ≤ 5 MB JPEG (section 16) |
| Payments | `react-native-razorpay` once the backend switches to Razorpay (section 6, PENDING) | |

Config per environment: `API_BASE_URL` (HTTPS in production), `APP_ENV`. Use `react-native-config` or Expo `extra`.

## 3. API conventions

**Every request:** `Content-Type: application/json`; authenticated calls add `Authorization: Bearer <accessToken>`.

**Success:** `{ "success": true, "message": "…", "data": … }` (status 200, 201 or 202; check `success`).
**Error:** `{ "success": false, "message": "…" }`. Exactly one message; show it as-is (they're user-readable). There are no error codes, so match on HTTP status, and on the exact message where this doc says so.

| Status | Meaning | App behaviour |
|---|---|---|
| 400 | validation or business rule | show `message` (field error when it maps to a field) |
| 401 | missing/invalid/expired token (`Token has expired.`, `Invalid token.`, `Authorization token is required.`) | clear tokens, go to Login with "Session expired" |
| 403 | role not allowed, or subscription/feature (section 7) | subscription messages → Paywall screen; otherwise toast |
| 404 | not found (also "not in your scope") | toast + go back |
| 409 | conflict (already pending, already reviewed, OTP errors, reused `Idempotency-Key` / gateway transaction) | show `message` |
| 429 | rate limit: `Too many requests. Please try again later.` | show `message`; wait for the `RateLimit-Reset` header (seconds) before retrying; never auto-retry in a loop |
| 5xx / network | server/network problem | retry button; keep cached data visible |

**Rate limits** (per process; may change): every request 600/min per IP; `/auth/*` 20 per 15 min per IP (login, signup, OTP); `create-order` + `verify` together 10/min per user.

**Axios setup (sketch):**

```ts
const api = axios.create({ baseURL: `${API_BASE_URL}/api/v1`, timeout: 15000 });

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync("accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message ?? "Network error. Please try again.";
    if (status === 401) await session.expire();               // clear + navigate to Login
    if (status === 403 && SUBSCRIPTION_MESSAGES.has(message)) paywall.open(message);
    return Promise.reject(new ApiError(status, message));
  },
);
```

**Pagination** (lists that support it): query `page` (from 1) and `limit`; response `data: { items, pagination: { page, limit, total, totalPages } }`. Use `useInfiniteQuery`.

**Scope:** the server decides which agents' data you get from the token (CSP → itself + its KOs; BC → its linked CSPs + their KOs). Never send another user's id hoping to read it; out-of-scope ids return 403/404.

## 4. Roles and navigation

`user.role` from login: `CSP_ADMIN` or `BC_ADMIN` (a `SUPER_ADMIN` login should be told to use the web console).

**CSP app (`CSP_ADMIN`)**

| Tab | Screens | APIs |
|---|---|---|
| Home | dashboard, today's numbers, float (if `CASH_MANAGEMENT`) | §11 |
| Machines | list, detail, analytics, SBI activity | §12 |
| Transactions | list with filters, detail, export | §13 |
| Reports | summary by period, export | §14 |
| More | subscription & payments, activation codes, KOs, profile, logout | §6, §8, §9 |

**BC app (`BC_ADMIN`)**

| Tab | Screens | APIs |
|---|---|---|
| Home | dashboard + CSP summary table, CSP monthly detail | §11 |
| CSPs | CSP list (agents), add CSP, link CSP (₹799), link requests | §9, §10 |
| Machines | machine monitoring | §12 |
| Reports | summary, export, transactions | §13, §14 |
| More | subscription & payments, activation codes (hidden on ₹799), CSP visits, metric entries, profile | §6, §8, §15, §16 |

Show/hide by plan: read the current plan's features (section 7).

## 5. Auth

### 5.1 Signup → OTP → login

```
[Signup form] --POST /auth/signup--> OTP sent to email --[OTP screen]--POST /auth/verify-otp--> [Login]
                                                         \-- "Resend" = POST /auth/signup again (same data)
```

**`POST /auth/check-agent`** (public, optional pre-check) `{ "agentId": "CSP-001" }` → 200 if the agent exists; 404 `Agent not found.`; 403 `KO cannot create login account.` Use it to show "this ID exists, continue to create your login". Signup works without it.

**`POST /auth/signup`** (public)

| Field | Rule (client + server) |
|---|---|
| `accountType` | `BC` or `CSP` (`Account type must be BC or CSP.`) |
| `name` | 2–100 chars |
| `agentId` | required; the BC/CSP id issued by the bank |
| `email` | valid email (OTP is sent here) |
| `phone` | 10–15 chars |
| `address` | required |
| `password`, `confirmPassword` | 8–100 chars, must match (`Passwords do not match.`) |
| `cashInHand` | **CSP: required.** Opening cash in hand, ₹ ≥ 0, max 2 decimals (`Cash in hand is required.`) |
| `cashInAccount` | **CSP: required.** Opening cash in the bank account (holding) (`Cash in account is required.`) |
| `cspLimit` | **CSP: required.** The CSP limit (`CSP limit is required.`). **`cashInHand` + `cashInAccount` must equal it** (`Cash in hand + cash in account must equal the CSP limit.`) |

The three cash fields are ignored for `BC`. Send numbers (a numeric string like `"2500.50"` also works). An empty field counts as missing, never as 0. Other messages: `… can't be negative.`, `… must be a number.`, `… can have at most 2 decimal places.`, `… is too large.` (max 9,999,999,999.99).

What the server does with them (CSP): stores them on the agent (`openingCash`, `openingCashInAccount`, `cashLimit`) and opens the CSP's **cash pool** (§13A): the limit and cash in account shared with its KOs, and the CSP's own cash in hand, with an `OPENING` entry in the cash ledger.

→ 201 `Signup successful. OTP sent for verification.` `data: { userId, openingFloat }`. `openingFloat` (CSP only):
- `CREATED`: the float was opened with these values.
- `UPDATED`: signup was sent again (resend OTP) before anything was recorded, so the new values replaced the old ones.
- `KEPT`: the agent already exists and its pool is in use (KOs added, receipts, settlements or adjustments recorded), so balances, opening values and limit stay as they are. Changes go through cash management (§13A).
Errors: 409 `Account already exists. Please login.`; 403 `KO cannot create login account.`

**`POST /auth/verify-otp`** (public) `{ agentId, otp }` — `otp` exactly 6 digits. OTP is valid **10 minutes**, **5 attempts**.
→ 200 `OTP verified successfully.` Then go to Login (no token is returned here).
Errors (409 unless noted): `Invalid OTP.`, `OTP has expired. Please request a new OTP.`, `Maximum OTP attempts exceeded. Please request a new OTP.`, 404 `OTP not found. Please request a new OTP.`, 404 `User not found.` For "request a new OTP", call signup again with the same data.

**`POST /auth/login`** (public) `{ agentId, password }`

```json
"data": {
  "accessToken": "…", "refreshToken": "…",
  "user": { "id": "…", "agentId": "CSP-001", "email": "…", "role": "CSP_ADMIN" }
}
```

Login errors (all **403**, show `message`): `Invalid credentials.` (unknown ID **or** wrong password; the server doesn't say which), then, only after a correct password: `Please verify your account first.` (→ OTP screen), `Your account has been blocked.`, `Your account has been suspended.` Not 401, so the session-expired interceptor (§3) doesn't fire on the login screen.

Errors: 404 `User not found.`; 403 `Please verify your account first.` (→ OTP screen), `Your account has been blocked.`, `Your account has been suspended.`, `Invalid credentials.`

### 5.2 Planned auth endpoints — PENDING (not built yet)

These are agreed but not implemented; the contracts below are proposals and may change. Build the screens behind a feature flag.

| Endpoint (proposed) | Body | Purpose |
|---|---|---|
| `POST /auth/resend-otp` | `{ agentId }` | resend the signup OTP (until then: call signup again) |
| `POST /auth/forgot-password` | `{ agentId }` | email a reset OTP |
| `POST /auth/reset-password` | `{ agentId, otp, password, confirmPassword }` | set a new password with the OTP |
| `POST /auth/refresh` | `{ refreshToken }` | new `accessToken` (+ rotated `refreshToken`) |
| `POST /notifications/devices` / `DELETE /notifications/devices/:token` | `{ token, platform: "ios" \| "android" }` | register/unregister the push token (Expo or FCM, provider TBD) |
| (no endpoint) activation email | — | assign/regenerate will email the code + password to the agent |

When `/auth/refresh` exists, the 401 interceptor should call it once, retry the request, and log out only if the refresh fails.

### 5.3 Session

- Store `accessToken` and `user` in secure storage. **Don't store the password.**
- The access token lasts **15 minutes** and **there is no refresh endpoint yet** (gap §19). Until there is one: on 401, show Login prefilled with the `agentId`. Keep the `refreshToken` stored; it'll be used when the endpoint exists.
- Logout = delete tokens + `queryClient.clear()`. There is no server-side logout call.
- On app start: token present → decode `exp` (e.g. `jwt-decode`); expired → Login.

## 6. Plans, subscription and payment

| Call | Notes |
|---|---|
| `GET /subscriptions/plans?ownerType=CSP\|BC` | public; only active plans and active billing cycles |
| `GET /subscriptions/current` | `data: null` when there's no active subscription |
| `GET /subscriptions/history` | all past subscriptions |
| `POST /payments/create-order` `{ planId, billingCycle, machineCount? }` + header `Idempotency-Key` | creates a pending payment; `machineCount` 1–100 for **CSP plans** (default 1), not allowed for BC plans |
| `POST /payments/verify` `{ paymentId, gatewayTransactionId, transactionReference? }` | completes it, creates/extends the subscription |
| `GET /payments/history`, `GET /payments/:paymentId` | own payments only |

Plan: `{ id, code, name, ownerType, level, machineLimit, pricing: [{ billingCycle, durationDays, price }], features: [{ code, name, description, category }] }` (`price` is a **string**).
Current subscription: `{ id, subscriptionNumber, status, subscriptionType, machineLimit, amountPaid (string), startDate, endDate, graceEndsAt, plan: { id, code, name, ownerType, level }, latestPayment: { paymentNumber, status, amount, totalAmount, paidAt } }`.
`create-order` returns the payment: `{ id, paymentNumber, amount, totalAmount, currency: "INR", status: "PENDING", planId, billingCycle, … }`.

**CSP checkout (per machine):**

```
[Plan + cycle] → [Machines: − 2 +]  → total = price × machines (show it; the server computes the same)
   → POST /payments/create-order { planId, billingCycle, machineCount: 2 }   → amount "500", machineCount 2
   → POST /payments/verify …                                                → subscription.machineLimit = 2
   → GET /activations: 2 activation codes → assign one to the CSP, one to a KO (section 8)
```

- `create-order` errors: 400 `Machine count can only be chosen for CSP plans.`; validation `Too small: expected number to be >=1` / `Too big: expected number to be <=100`; 403 for roles other than CSP/BC.
- A pending order is reused only if plan, cycle **and** machine count match; otherwise a new order is created.
- **`Idempotency-Key` header (send it):** generate a UUID when the user taps **Pay** and reuse it for every retry of that same attempt (timeout, app resumed, double tap). A retry with the same key returns the **same payment** (even after it succeeded), so the user is never charged twice. A new attempt (different plan/cycle/machines) needs a new key; reusing a key for a different order → 409 `This Idempotency-Key was already used for a different order.` Format: 8–128 of `A–Z a–z 0–9 - _ : .`; otherwise 400.
- **Retries and slow internet** (axios `timeout: 15000`):
  - `create-order` timed out / network error → retry up to **3 times** (backoff 2 s, 4 s, 8 s) with the **same** `Idempotency-Key`. Never generate a new key for the same tap.
  - `verify` timed out / network error / 5xx → retry up to **5 times** (2, 4, 8, 16, 30 s) with the **same body**. A retry after the server already completed it returns **200** `Payment already verified.` with the same `subscriptionId`, so it's safe.
  - Still failing → show "Payment is being confirmed. We'll update your plan shortly." and poll `GET /payments/:paymentId` every 10 s for 2 min (and on app resume) until `status` is `SUCCESS`; then refresh `GET /subscriptions/current`. Don't send the user back to checkout while a payment is `PENDING`.
  - 429 → wait for `RateLimit-Reset` seconds, then one retry. 400/403/404/409 → don't retry; show `message`.
  - Persist `{ paymentId, idempotencyKey }` of an unfinished checkout (AsyncStorage) so a killed app resumes with the same values.
- The server also serialises orders per user and completes a payment only once: a second `verify` with a **different** `gatewayTransactionId` for an already paid payment → 400 `Payment is already verified.`; a `gatewayTransactionId` already used by another payment → 409 `This gateway transaction is already linked to another payment.` Disable the Pay button while a request is in flight anyway.
- Machine slots in use: count activations on the current subscription (`GET /activations`).

**Purchase rules (server):**
- Same plan **and same machine count** while it's running → **renewal**: the end date is extended from the current end date; machines keep working.
- Same plan with a **different machine count** (adding/removing machines) → a new subscription starts now with the new count; the old one ends; activated machines carry over (up to the new count); missing codes are generated. No credit for unused days.
- Different plan → **upgrade/switch**: a new subscription starts now and the old one ends immediately. Machines already activated move to the new plan (up to its machine limit). No refund/credit for unused days.
- After the plan ended → new subscription from now. No grace period.
- Buying a plan of the wrong owner type → 400 `This plan is not available for your account.`; unknown cycle → 400 `Selected billing cycle is not available.`

**Payment status — PENDING backend work:** today the payment is "manual": the app calls `create-order` and then `verify` with any `gatewayTransactionId`. Razorpay is being integrated (pre-production checklist 1.1–1.5). Build the checkout behind one function `payForPlan(planId, billingCycle)` so swapping in `react-native-razorpay` later only changes that function. Don't ship the manual flow to production users.

**UI notes:** plan cards list every `pricing` entry (cycle selector); CSP plans show "per machine" and a machine stepper (default: current `machineLimit`). Show "Renews on `endDate`". Switching a machine plan to `BC_CSP_LINK` (0 machines) must warn: "Your machines will stop working."

## 7. Paywall and feature gating

Every data screen needs an **active subscription**. The server answers 403 with one of:

```
No subscription found. Please purchase or activate a subscription to continue.
Your subscription has expired.
Your subscription has been suspended.
Your subscription has been cancelled.
Your subscription is pending activation.
Your subscription has not started yet.
```

→ open the Paywall/Plans screen with that message. (Plans, current subscription, payments and login stay accessible.)

**Features** (`GET /subscriptions/current` → plan code, `GET /subscriptions/plans` → plan features): build a `features: Set<string>` for the current plan and gate UI:

| Feature | UI |
|---|---|
| `CASH_MANAGEMENT` | float / cash-in-hand / cash-in-account cards, denomination detail. **CSPs without it:** the server returns these fields as `null` (dashboard `float`, machine list `float`, machine monitoring float fields, receipt `cashDenomination`). Render "Upgrade to see cash" instead of 0. BCs always get them. |
| `CSP_LINKING` | BC "Link CSP" and "Link requests" screens (§10) |
| `DESKTOP_AUTOMATION`, `RECEIPT_SYNC` | informational in the app (they gate the desktop) |
| `MOBILE_TRACKING` | reserved; nothing to build yet |

`403 Your subscription does not include this feature.` → upgrade prompt.

## 8. Activations (machine codes)

Buying a machine plan creates one activation per machine (`machineLimit`; for a CSP = the machines bought). The owner **assigns** an activation to an agent, gets a one-time **password**, and the person at the PC types `agentId` + activation code + password into the desktop app.

| Call | Who | Notes |
|---|---|---|
| `GET /activations` | owner | all activations of the owner's subscriptions |
| `GET /activations/:activationId` | owner | adds `canRegenerate` |
| `POST /activations/assign` `{ activationId, assignedAgentId }` | owner | returns `{ activationCode, activationPassword }` **once** |
| `POST /activations/:activationId/regenerate-password` | owner | only while `NOT_ACTIVATED`; returns a new password once |
| `POST /activations/:activationId/revoke-requests` `{ reason? }` | owner (CSP / BC) | asks the super admin to revoke it: see **Revoke** below |
| `GET /activations/revoke-requests?status=&activationId=&page=&limit=` | owner | own requests, newest first |
| `GET /activations/revoke-requests/:requestId` | owner | one request |
| `POST /activations/revoke-requests/:requestId/cancel` | owner | only while `PENDING` |

Activation: `{ id, activationCode (XXXX-XXXX-XXXX-XXXX), activationPassword (DEV ONLY, below), status, expiresAt, assignedAgentId, assignedAt, activatedAt, isCurrent, machine: { machineCode, machineName, status, isOnline, lastHeartbeatAt } | null, subscription: { subscriptionNumber, endDate } }`. `status`: `NOT_ACTIVATED`, `ACTIVE`, `INACTIVE`, `REVOKED`, `TRANSFERRED`.

**Who can be assigned:**
- **CSP owner:** itself or one of **its KOs** (`CSP can assign only to KO.`, `KO does not belong to this CSP.`).
- **BC owner:** any agent whose BC is this BC (`Agent does not belong to this BC.`).

Other errors: `Activation not found.` (404), `Activation has already been used.`, `Activation is already assigned.`, `Agent is inactive.`, `Activation password cannot be regenerated.`

**Revoke** (replace a PC, move a code to another agent) **needs super admin approval**. The CSP or BC raises a request; the activation keeps working until the super admin approves it.

```
Activation detail → [Revoke]  → confirm sheet (optional reason, max 500 chars)
   → POST /activations/:id/revoke-requests { reason }        → 201, request PENDING
   → detail shows "Revoke requested (RVK-2026-000001)" + [Cancel request]
super admin approves → activation NOT_ACTIVATED, unassigned, PC stopped   → assign it again (new password)
super admin rejects  → request REJECTED (reviewRemarks = why); activation unchanged
```

- Allowed when the activation is `ACTIVE` (in use on a PC) or `NOT_ACTIVATED` but assigned. Otherwise 400 `Only an activation that is in use or assigned can be revoked.`
- One open request per activation: a second one → 409 `A revoke request for this activation is already pending.`
- `GET /activations` and `GET /activations/:id` now include **`pendingRevokeRequest`**: `{ id, requestNumber, createdAt }` or `null`. Use it to show the "Revoke requested" badge and hide the Revoke button.
- Request object: `{ id, requestNumber (RVK-YYYY-NNNNNN), status: PENDING|APPROVED|REJECTED|CANCELLED, activationId, activationCode, activationStatus, assignedAgentId, ownerType, ownerId, machineCode (PC holding it when requested), currentMachine { machineCode, machineName } | null, reason, reviewRemarks, reviewedAt, createdAt, updatedAt }`.
- Create returns 201 with message `Revoke request sent. The activation keeps working until the super admin approves it.`
- Cancel: 200 `CANCELLED`; on a reviewed request → 409 `Only pending requests can be cancelled.` Other users' requests → 404 `Revoke request not found.`
- After approval the code keeps its **same expiry** (no extra days); assign it again to get a new password and activate it on any PC.
- **Notifications:** push for "approved / rejected" isn't built yet (pre-production checklist 2.14). Until then refresh the request list on screen focus and pull-to-refresh, and poll `GET /activations/revoke-requests?status=PENDING` every 60 s while that screen is open.
- **Screens:** "Revoke requests" list (tabs Pending / Approved / Rejected / Cancelled) reachable from Activations; each row shows activation code, machine, status chip, reason and the admin's `reviewRemarks`.
- **Not needed after a Windows reinstall/format:** the same PC re-activates with the same code and password (the desktop handles it). Revoke only when the PC itself is replaced or the code should go to someone else.

**DEV ONLY — removed before production:** until activation emails exist, `GET /activations` and `GET /activations/:id` include **`activationPassword`** (the latest assigned/regenerated password, or `null`). Production builds won't get this field (pre-production checklist 2.11), so don't depend on it: treat it as optional.

**UI:** list grouped by status. On assign/regenerate show code + password in a modal with **Copy** and **Share** buttons. In dev builds the list can show a "Show password" toggle when `activationPassword` is present; in production the modal is the only place the password appears ("shown only once"; later it'll also be emailed). Never store the password in the app. A BC on `BC_CSP_LINK` has no activations: show "This plan doesn't include machine activations".

## 9. Agents: CSPs and KOs

| Call | Who | Notes |
|---|---|---|
| `GET /agents?type=CSP\|KO&parentAgentId=&page=&limit=` | any | limited to your scope; `limit` ≤ 100, default 10 |
| `GET /agents/:agentId` | any | in scope only |
| `POST /agents/csp` | BC | create a new CSP, or request to link an existing one |
| `POST /agents/ko` | CSP | create a KO, or link an existing unlinked KO |
| `PATCH /agents/:agentId` | owner | `{ name?, mobile?, email?, address?, cashLimit?, openingCash?, openingCashInAccount?, status? (ACTIVE\|INACTIVE) }` (opening values don't change a float that is already open) |
| `DELETE /agents/:agentId` | owner | soft delete |

Agent: `{ id, agentId, name, type, mobile, email, address, bcId, parentAgentId, cashLimit (string\|null; the CSP limit), openingCash (string\|null; opening cash in hand), openingCashInAccount (string\|null; opening cash in account), linkedAt, createdAt, updatedAt }`.

**`POST /agents/csp` (BC)** body: `{ agentId, name, mobile?, email?, address?, cashLimit, openingCash, openingCashInAccount, machineCount, kos?: [{ agentId, name, mobile?, email?, address?, openingCash, machineCount }] }`.
- **New CSP:** `cashLimit` (CSP limit), `openingCash` (cash in hand) and `openingCashInAccount` (cash in account) are **required** (`CSP limit is required.`, `Cash in hand is required.`, `Cash in account is required.`), and cash in hand + cash in account must equal the limit. They open the CSP's cash pool (§13A). For an **existing** CSP (link request, 202) they're ignored.
- **KO:** only `openingCash` (its cash in hand), **required** (`Cash in hand is required.`). A KO shares its CSP's limit and cash in account, so `cashLimit` / `openingCashInAccount` sent for a KO are ignored. The KO's cash in hand is taken from the CSP's cash in account: 400 `Not enough cash in account for this KO's cash in hand: …` when it doesn't cover it (nothing is created).

| Case | Response |
|---|---|
| new CSP id | **201** `CSP created successfully.` `data: { csp, kos }` (opening float recorded from `openingCash` + `openingCashInAccount`) |
| existing, unlinked CSP | **202** `This CSP already exists. A link request was sent to the admin for approval.` `data: { csp: null, kos: [], linkRequest }` |
| CSP linked to another BC | **202** `This CSP is linked to another BC. A link request was sent to the admin for review.` (`linkRequest.isConflict = true`) |
| already linked to you | 400 `CSP is already linked with this Business Correspondent.` |
| existing CSP **with `kos`** | 400 `Add KOs after the CSP link is approved.` |
| id belongs to a KO/BC | 400 `Provided Agent ID does not belong to a CSP.` |
| pending request exists | 409 `A link request for this CSP is already pending.` |

Handle **202 separately**: `csp` is `null`; show a success toast and open "Link requests" (§10). The CSP and its KOs appear in your data only after approval.

Validation (400, first problem): `agentId` 1–50 chars, `name` 2–100, `mobile` 10–15 chars, valid `email`, `cashLimit` / `openingCash` ≥ 0, `kos` ≤ 50. `machineCount` is optional (default 0) and no longer used: machines come from the owner's activations.

**`POST /agents/ko` (CSP)** body: `{ agentId, name, mobile?, email?, address?, openingCash, machineCount }`: `openingCash` (cash in hand) required, taken from the CSP's cash in account (as above) → 201 `KO created successfully.` `data: { ko }`. Works for every CSP (with or without a BC). Errors: `KO is already linked with this CSP.`, `KO is already linked with another CSP.`, `Provided Agent ID does not belong to a KO.`

**Edit/delete rules:**
- A BC **can't edit or delete** CSPs linked through a ₹799 link request, or their KOs → 403 `This CSP is linked for viewing only. It manages its own account.` Hide edit/delete for those (`linkType` on the link request; or catch the 403).
- `You cannot delete your own account.`; `Delete child agents first.` (delete KOs before the CSP); `You are not allowed to update/delete this agent.`

## 10. BC ₹799: link existing CSPs (with their KOs)

Only for a BC whose plan has `CSP_LINKING`. The BC finds a CSP that already has its **own active subscription**, sends a request, and a **Super Admin approves** it. Approval links the **CSP and all of its KOs** to the BC.

```
BC: search ─► "Send link request" ─► PENDING ─┬─ Admin approves ─► APPROVED: CSP + KOs now in BC's data
                                              ├─ Admin rejects  ─► REJECTED (reviewRemarks shown)
                                              └─ BC cancels     ─► CANCELLED
```

**Search** `GET /bc-links/csps/search?search=<≥2 chars>` (BC). Matches CSP id or name; max 20; only subscribed CSPs.

```json
"data": [{ "agentId": "CSP-001", "name": "…", "address": "…", "koCount": 2,
           "linkStatus": "NOT_LINKED", "hasPendingRequest": false }]
```

`linkStatus`: `NOT_LINKED` | `LINKED` (yours) | `LINKED_TO_OTHER_BC`. Row UI: "Linked" badge, "Request pending" badge, or "Send link request" (for `LINKED_TO_OTHER_BC` add "Linked to another BC; the admin will review it"). Show "+ `koCount` KOs" so the BC knows the KOs come along. Debounce 300 ms.

**Request** `POST /bc-links/requests` `{ cspAgentId, remarks? (≤500) }` → 201 `Link request submitted for admin approval.` (or the conflict message, `isConflict: true`).
Errors: 404 `CSP not found.`; 400 `This CSP does not have an active subscription.`; 400 `CSP is already linked with this Business Correspondent.`; 409 `A link request for this CSP is already pending.`; 403 feature/subscription messages.

**My requests** `GET /bc-links/requests?status=&isConflict=&cspAgentId=&page=&limit=` (own only), `GET /bc-links/requests/:id`, `POST /bc-links/requests/:id/cancel` (pending only; else 409 `Only pending requests can be cancelled.`).

Link request:

```json
{ "id": "…", "requestNumber": "LNK-2026-000001", "status": "PENDING",
  "bcId": "BC0001", "bcName": "…", "cspAgentId": "CSP-001", "cspName": "…",
  "isConflict": false, "linkType": "SUBSCRIBED_CSP",
  "currentBcId": null, "cspCurrentBcId": null,
  "remarks": "…", "reviewRemarks": null, "reviewedAt": null, "createdAt": "…", "updatedAt": "…" }
```

- `linkType`: `SUBSCRIBED_CSP` (₹799: the BC sees the CSP only while the CSP's plan is active; view-only) or `BC_MANAGED` (from `POST /agents/csp` by a machine-plan BC; the BC provides the machines and may edit).
- `currentBcId` / `cspCurrentBcId` are always `null` in the app (which other BC owns a CSP is admin-only).
- No push notifications yet: refetch the list on screen focus and pull-to-refresh to pick up approvals.

**After approval:** the CSP and its KOs show up in agents, dashboard (CSP summary), machines, transactions and reports. If a `SUBSCRIBED_CSP` CSP's own subscription lapses, it **disappears** from the BC's data (still linked) and comes back when it renews. Opening it meanwhile returns 403/404 → show "This CSP's subscription is inactive" and refresh lists.

## 11. Dashboard

> **Data retention (from rev 7).** The server keeps individual receipts for **60 days by default** (today + the previous N IST days; the super admin can set N from 15 to 365) and per-day **counts for 1 year**. Every count and amount on this screen (overview, services, status, machine monitoring, CSP summary, analytics day/week/month/year, CSP monthly detail, reports) comes from the daily counts, so ranges up to a year back stay correct. Only these need the receipts themselves and so cover the retention period: `recentTransactions`, hourly charts (`groupBy=hour`, `hourlyDistribution`) and the transaction list/detail/export (§13). Limit date pickers to the last 12 months; for hourly charts and the transaction list, assume at least the last 15 days and show the empty state for older ranges.

**`GET /dashboard/summary`** query (all optional): `from`, `to` (ISO dates; **default today**: send a range to see older days), `agentId`, `machineId`, `receiptType`, `transactionCategory`, `search`. `from` must be ≤ `to`.

`agentId` picks whose numbers to show, inside your scope (else 403):
- **A KO** → that KO only (single-agent view: `float` + `machine`).
- **A CSP** → the CSP **and all its KOs** (same as the CSP's own login). A CSP without KOs gets the single-agent view.
- **Omitted** → your whole scope (BC: all its CSPs and KOs; CSP: itself + its KOs).

The same rule applies to `GET /dashboard/analytics`, which used to ignore `agentId`.

Common fields:

```
overview:          { totalTransactions, successfulTransactions, failedTransactions, totalTransactionAmount, lastTransactionAt, successRate, failureRate }
services:          [{ transactionCategory, receiptType, successCount, failedCount, successAmount, failedAmount }]
servicesByCategory:[{ transactionCategory, totalCount, successCount, failedCount, pendingCount, successAmount }]   // all receipt types together, most-used first; use for the "services" tiles
cash:              { totals: { cashLimit, cashInAccount, totalCashInHand, drawer, drawerTotal },
                     pools: [ <pool view, §13A> ] } | null   // null for CSP plans without CASH_MANAGEMENT; the agents in view only (agentId=KO → that KO)
statusSummary:     { success, failed, total }
activationSummary: { total, used, unused }
recentTransactions:[{ receiptId, receiptType, transactionCategory, status, amount, transactionAt, customerName, customerAccount, rrn, stan }]
subscription:      { subscriptionNumber, subscriptionType, status, machineLimit, amountPaid, startDate, endDate, graceEndsAt, createdSource } | null
```

Single-agent view (CSP, or BC with `agentId`) adds:

```
float:   { openingFloat, currentCashInHand, currentCashInAccount, currentTotalFloat, lastReceiptAt, updatedAt } | null (CSP without CASH_MANAGEMENT)
machine: { machineCode, machineStartedAt, firstReceiptCapturedAt, lastReceiptCapturedAt, receiptWatcherVersion, lastHeartbeatAt, connectionStatus, machineStatus }
```

Multi-agent view (BC) adds:

```
machineMonitoring: { summary: { totalMachines, onlineMachines, offlineMachines, activeMachines, inactiveMachines, onlinePercentage },
                     monitoring: [{ agentId, agentName, machineCode, watcherVersion, machineStatus, connectionStatus, lastHeartbeatAt, lastReceiptCapturedAt,
                                    openingFloat, currentCashInHand, currentCashInAccount, currentTotalFloat, lastReceiptAt, lastReceiptUpdatedAt,
                                    transactionCount, transactionAmount, successTransactions, failedTransactions, onlineHours, averageOnlineHours, sessionCount, unexpectedStops }] }
cspSummary:        { transactions:   [{ agentId, cspName, totalTxn, passbookPrinter, cashWithdrawal, cashDeposit, microAtmTxn, accountOpening, miniStatement, balanceInquiry, moneyTransfer, fundTransfer }],
                     socialSecurity: [{ agentId, cspName, location, bcName, metrics: [...] }] }
```

Float values are numbers on the CSP view and **strings** in BC `machineMonitoring`; parse with `Number()`.

**`GET /dashboard/analytics`** same query + `groupBy` = `hour|day|week|month|year` (default `day`) → `{ transactionTrend, successFailureTrend, serviceTrend: [{ transactionCategory, count, amount }], hourlyDistribution }` for charts (e.g. `victory-native` / `react-native-gifted-charts`).

**`GET /dashboard/csp/:agentId/detail?section=transaction|socialSecurity&month=YYYY-MM`** (BC, CSP in scope): day-by-day table for one month.
- `transaction` → `{ agentId, cspName, month, section, transaction: [{ date, totalTxn, passbookPrinter, cashWithdrawal, cashDeposit, microAtmTxn, accountOpening, miniStatement, balanceInquiry, moneyTransfer, fundTransfer }] }`
- `socialSecurity` → `{ …, socialSecurity: [{ date, metrics: [...] }] }`
- Errors: `section must be socialSecurity or transaction.`, `month must be in YYYY-MM format.`, `Future month is not allowed.`, `CSP not found.`

Refresh: refetch summary on focus and every 60 s while the Home tab is visible (`refetchInterval`).

## 12. Machines

| Call | Notes |
|---|---|
| `GET /machines/list` | query: `page`, `limit` (≤100), `search`, `agentId`, `agentType`, `machineStatus` (`PENDING\|ACTIVE\|OFFLINE\|BLOCKED\|RETIRED`), `connectionStatus` (`ONLINE\|OFFLINE`), `watcherEnabled`, `sortBy` (`updatedAt\|machineName\|machineCode\|lastHeartbeatAt`), `sortOrder`, `from`, `to` |
| `GET /machines/:machineId` | detail; `from`/`to` for the stats range |
| `GET /machines/:machineId/analytics` | machine sessions: summary, `daily: [{ date, onlineHours, sessionCount }]`, `sessions` |
| `GET /machines/:machineId/activity-sessions` | CSP SBI-login activity: `{ isActive, agentId, activeSince, activeSeconds, sessions }` |
| `GET /machines/:machineId/heartbeat` | live status: `{ connectionStatus, lastHeartbeatAt, watcherVersion, latestWatcherVersion, watcherEnabled, receiptUploadEnabled, subscriptionStatus, heartbeatInterval }` |
| `PATCH /machines/:machineId` | `{ machineName? (1–100), watcherEnabled? }` |

List item: `{ machine: { machineId, machineCode, machineName, watcherVersion, watcherEnabled, machineStatus, connectionStatus, lastHeartbeatAt, lastStartupAt, lastReceiptCapturedAt, ipAddress, deviceName, osName, osVersion }, agent: { agentId, name, type }, float: {…} | null, transaction: { count, amount, success, failed }, services: [...], children: [...] }`. **Use `item.machine.machineId` for detail calls.**

Detail: `{ machineId, machineCode, machineName, agent, status: { machineStatus, connectionStatus, lastHeartbeatAt, lastStartupAt }, runtime: { isSessionActive, sessionId, startedAt, onlineHours }, cspActivity: { isActive, agentId, activeSince, activeSeconds }, float, watcher: { version, enabled }, device, activity, overview, services, statusSummary, recentTransactions, children: [ per CSP/KO: agent fields + status + machine + transaction + services ] }`.

- `connectionStatus` is `ONLINE` when the last heartbeat is < 180 s old. Show a green/grey dot; refresh the detail every 30–60 s.
- `cspActivity.isActive` = "CSP is logged in to SBI right now".
- Turning `watcherEnabled` off stops the desktop's automation and uploads on that PC; confirm first.

## 13. Transactions (receipts)

`GET /receipts` query: `page`, `limit` (≤100, default 20), `from`, `to`, `period`, `machineId`, `agentIds`, `receiptTypes`, `transactionCategories`, `status` (`SUCCESS|FAILED|PENDING`), `search`, `sortBy` (`transactionAt|createdAt|amount`), `sortOrder`. Older single-value `agentId`, `receiptType` and `transactionCategory` still work.

| Filter | How to send | Notes |
|---|---|---|
| `agentIds` | `agentIds=KO1,KO2` or `agentIds=KO1&agentIds=KO2` | exact agents (a CSP id means that CSP's own receipts); each must be in your scope (403 `You are not allowed to access this CSP.`); omit for **all** |
| `receiptTypes` | `receiptTypes=AEPS,PASSBOOK` | any of the `receiptType` values below; unknown → 400 |
| `transactionCategories` | `transactionCategories=CASH_DEPOSIT,MONEY_TRANSFER` | any of the `transactionCategory` values below |
| `period` | `TODAY` \| `YESTERDAY` \| `CURRENT_MONTH` \| `LAST_MONTH` \| `CUSTOM` | IST days; `from`/`to` win over it (use them for a custom range); no period and no dates = no date filter |

At most 100 values per list. For "all agents of a CSP", omit `agentIds` (CSP login) or send the CSP and its KO ids.

Item: `{ receiptId, receiptType, transactionCategory, status, amount, transactionAt, createdAt, customerName, customerAccount, rrn, stan, agentId, machineCode, machineName }`.

`GET /receipts/:receiptId` (use **`receiptId`**) → `{ …, cashDenomination: { notes500, notes200, notes100, notes50, notes20, notes10, notes5, coins20, coins10, coins5, coins2, coins1 } | null, machine: { machineCode, machineName }, agent: { agentId, name, type } }`. `cashDenomination` is `null` when none was captured or the CSP plan lacks `CASH_MANAGEMENT`.

`GET /receipts/stats` (same filters) → `{ total, success, failed, totalAmount }`. Without `search` it reads the daily counts (up to a year back); with `search` it counts receipts (last 60 days). With `status=SUCCESS`, `failed` is now `0` (older builds ignored the filter for `failed`).

**Retention:** the list, detail and export return receipts from the retention period only (60 days by default, set by the super admin, at least 15). Older ones are deleted on the server; their counts stay in dashboards and reports. When a range returns nothing, show "Older transactions aren't kept; counts are in Reports".
`GET /receipts/export` (same filters, including `agentIds`, `receiptTypes`, `transactionCategories` and `period`) → Excel file (§17). Example: yesterday's withdrawals of two KOs: `/receipts/export?period=YESTERDAY&agentIds=KO1,KO2&transactionCategories=CASH_WITHDRAWAL`. `/receipts/stats` takes the same filters.

Enums for filters:
- `transactionCategory`: `CASH_DEPOSIT`, `CASH_WITHDRAWAL`, `MONEY_TRANSFER`, `FUND_TRANSFER`, `BALANCE_ENQUIRY`, `MINI_STATEMENT`, `ACCOUNT_OPENING`, `BBPS`, `MICRO_ATM`, `SOCIAL_SECURITY`, `PASSBOOK_PRINTING`, `LOAN`, `OTHER`
- `receiptType`: `AEPS`, `ACCOUNT`, `CARD`, `BBPS`, `MICRO_ATM`, `ACCOUNT_OPENING`, `APY`, `PMJJBY`, `PMSBY`, `MUDRA_LOAN`, `PASSBOOK`, `UNKNOWN`

`receiptId` is unique **per agent** (two agents can have the same value). Open a receipt from the list item you have; `GET /receipts/:receiptId` is limited to your scope.

`amount` is `null` for non-cash categories (balance enquiry, mini statement…): show "—", not ₹0. Only cash deposit, cash withdrawal and money transfer move the float.

## 13A. Cash management (CSP + KOs)

A CSP and its KOs share **one cash limit** and **one cash in account (holding)**: the **pool**. Each agent (the CSP and each KO) has its **own cash in hand** and its own **drawer** (note/coin counts). Always:

```
cash in account + cash in hand (CSP) + cash in hand (every KO) + in bank (open KO settlements) + left in bank = cash limit
```

Nothing ever goes below ₹0. Who can do what:

| | CSP | BC | Super admin | KO (desktop) |
|---|---|---|---|---|
| View pool, every agent's cash in hand and drawer, ledger, requests | yes | yes (send `agentId`) | yes (send `agentId`) | own cash only (heartbeat) |
| Settle, adjust (limit, cash in account, cash in hand, drawer) | yes | no | no | no |
| KO settlements (cash in account ↔ bank ↔ cash in hand) | **informed only** (feed) | sees them | sees them | starts and approves its own, from the desktop |
| Approve / reject a KO's change request | yes | no | no | asks from the desktop |

All endpoints need the `CASH_MANAGEMENT` plan feature for CSP plans (403 `Your subscription does not include cash management.`).

### How balances move

| Event | Cash in hand (of the agent) | Cash in account (shared) |
|---|---|---|
| Cash deposit | + amount | − amount |
| Money transfer | + amount | − amount |
| Cash withdrawal | − amount | + amount |
| KO settlement, step 1 account → bank | — | − amount (held in bank) |
| KO settlement, step 2 bank → hand (notes counted, ≤ amount) | + counted | — (amount − counted stays **left in bank**) |
| KO settlement, step 1 hand → bank | − amount (notes out) | — (held in bank) |
| KO settlement, step 2 bank → account (credited, ≤ amount) | — | + credited (the rest stays **left in bank**) |
| KO settlement left in bank → hand: request (held) | — | — (left in bank − amount, held in bank) |
| KO settlement left in bank → hand: approved (notes counted, ≤ amount) | + counted | — (amount − counted back to left in bank) |
| CSP settlement account → hand | + amount | − amount |
| Settlement hand → account | − amount | + amount |
| Limit raised / lowered (no new cash in account given) | — | + / − the difference |
| KO added with cash in hand X | + X (the KO's) | − X |
| PC activated: the agent counts cash in hand Y (was X) | set to Y; drawer set to the count | − (Y − X) |

Other categories don't move cash yet. A receipt reaches the server **after** the bank transaction, so it's never refused for cash. If the balance can't cover it, it's saved and counted but **not applied** (balances unchanged) and shows in the ledger as `RECEIPT_NOT_APPLIED` with a `reason`: `INSUFFICIENT_CASH_IN_HAND`, `INSUFFICIENT_CASH_IN_ACCOUNT`, or `NOT_SET_UP` when the CSP has no pool yet. Show these to the CSP as "to fix" (settle or adjust). The desktop checks the balance before a transaction, so this should be rare.

**Drawer:** each cash receipt's denomination adds to (deposit, money transfer) or takes from (withdrawal) the agent's drawer. A count never goes below 0, and the drawer is never used to refuse anything. `drawerMatchesCashInHand` is `false` when the drawer total differs from cash in hand (e.g. opening cash entered without a denomination); the CSP can set the drawer in an adjustment.

### `GET /cash-management?agentId=` — the pool

CSP: no `agentId` = the whole CSP (merged + every agent); `agentId=<KO>` = that KO on its own. BC / super admin: `agentId` (a CSP or one of its KOs) is required (400 `agentId is required (a CSP or one of its KOs).`); outside your scope → 403.

```json
"data": {
  "cspAgentId": "CSP-001", "cspName": "…", "setUp": true,
  "cashLimit": 100000, "cashInAccount": 45000, "totalCashInHand": 55000,
  "drawer": { "notes500": 90, "notes200": 0, "notes100": 50, "…": 0 }, "drawerTotal": 50000,
  "agents": [
    { "agentId": "CSP-001", "name": "…", "type": "CSP", "cashInHand": 5000, "drawer": { … }, "drawerTotal": 5000, "drawerMatchesCashInHand": true },
    { "agentId": "KO-001", "name": "…", "type": "KO", "cashInHand": 50000, "drawer": { … }, "drawerTotal": 45000, "drawerMatchesCashInHand": false }
  ],
  "cashInTransit": 0, "cashLeftInBank": 0, "pendingRequests": 1, "openSettlements": 0, "updatedAt": "…"
}
```

`setUp: false` (limit and cash in account `null`) is a CSP that existed before cash management. Show a "Set up cash" screen that sends one ADJUSTMENT with `cashLimit`, `cashInAccount` and each agent's `cashInHand`. Money values are numbers in rupees (2 decimals).

### `POST /cash-management/transactions` (CSP) — settle or adjust

Optional header `Idempotency-Key` (8–128 chars): a retry with the same key returns 200 `Already recorded (same Idempotency-Key).` without applying twice; the same key for a different request → 409. Send a new key per tap. There's no daily limit on settlements. Response 201 (`Settlement recorded.` / `Cash adjusted.`) with the updated pool view.

**Settlement** moves cash between cash in account and one agent's cash in hand:

```json
{ "type": "SETTLEMENT", "agentId": "KO-001", "amount": 50000, "direction": "ACCOUNT_TO_HAND", "remarks": "Cash for withdrawals" }
```

`direction`: `ACCOUNT_TO_HAND` | `HAND_TO_ACCOUNT`; `amount` > 0. Errors (400): `Not enough cash in account: ₹… available, ₹… needed.`, `Not enough cash in hand: …`, `Agent … isn't part of this CSP.`, `Cash management isn't set up for this CSP yet. …`. Example: limit 1L, cash in account 95K, KO cash in hand 5K; settle 50K → cash in account 45K, KO cash in hand 55K.

**Adjustment** sets values by hand (corrections, raising the limit, setting the drawer, first setup). `remarks` is required; send only what changes:

```json
{ "type": "ADJUSTMENT", "cashLimit": 120000, "remarks": "Bank raised the limit" }
{ "type": "ADJUSTMENT", "cashInAccount": 60000, "agents": [{ "agentId": "KO-001", "cashInHand": 55000, "drawer": { "notes500": 100, "notes100": 50 } }], "remarks": "Counted the drawer" }
{ "type": "ADJUSTMENT", "cashLeftInBank": 0, "cashInAccount": 53500, "remarks": "Bank returned the rest" }
```

Rules:
- A new `cashLimit` without `cashInAccount` moves cash in account by the difference (raise by 20K → cash in account +20K).
- The result must keep cash in account + all cash in hand + in bank + left in bank = cash limit: 400 `Cash in hand (₹… in total) + cash in account (₹…) [+ in bank (₹…, open settlements)] [+ left in bank (₹…)] must equal the cash limit (₹…).`
- `cashLeftInBank` sets what partly delivered KO settlements left in bank, e.g. to 0 when the bank returns it (raise `cashInAccount` by the same amount). Audited like every adjustment (ledger `cashLeftInBankChange`). 400 `Nothing is left in bank before cash management is set up.` when there's no pool yet.
- The CSP's direct `SETTLEMENT` and every `ADJUSTMENT` are in the ledger with `actorType: USER` and the user's id.
- Nothing below 0: 400 `Cash in account can't go below ₹0.00: …`
- Drawer keys you leave out keep their count.
- Other 400s: `Remarks are required.`, `Nothing to change.`, `Each agent can appear only once.`

### `GET /cash-management/ledger` — audit

Query: `agentId` (as for the pool), `agentIds` (one or more agents individually; omit for all agents merged), `types` (`OPENING`, `AGENT_ADDED`, `RECEIPT`, `RECEIPT_NOT_APPLIED`, `SETTLEMENT`, `ADJUSTMENT`, `REQUEST_APPROVED`, `ACTIVATION`, `SETTLEMENT_TO_BANK`, `SETTLEMENT_FROM_BANK`, `SETTLEMENT_HELD`, `SETTLEMENT_CANCELLED`; several allowed), `period` / `from` / `to` (as in §13), `page`, `limit` (≤100). Newest first.

`ACTIVATION` entries are the cash in hand and drawer counted on the desktop when a PC is activated.

Item: `{ id, type, reason, agentId, agentName, agentType, transactionCategory, amount, cashInHandChange, cashInAccountChange, cashLimitChange, cashInTransitChange, cashLeftInBankChange, balanceCashInHand, balanceCashInAccount, balanceCashLimit, balanceCashInTransit, balanceCashLeftInBank, drawerChange, receiptId, requestId, settlementId, actorType (USER|MACHINE|SYSTEM), actorId (userId or machineCode), remarks, createdAt }` + `pagination`. Every change, from the app or the desktop, is recorded here.

### KO settlements (the KO approves its own; the CSP is informed)

A KO settles from its desktop, in two steps it approves itself; **the CSP doesn't approve anything**, it just sees what happens (push notifications later: checklist 2.16):

| Direction | Step 1 (KO creates) | Step 2 (opens when the KO approves step 1) |
|---|---|---|
| `ACCOUNT_TO_HAND` | cash in account → bank: the amount is taken out of the shared cash in account at once and held "in bank" | bank → cash in hand: the KO enters the notes received (total ≤ amount); they go into its drawer and cash in hand; any difference stays **left in bank** |
| `HAND_TO_ACCOUNT` | cash in hand → bank: amount + the notes taken out of the drawer | bank → cash in account: the KO enters the amount credited (≤ amount; default all); any difference stays **left in bank** |
| `BANK_TO_HAND` | — (one step only) | left in bank → cash in hand: the amount is taken out of **left in bank** at once and held; the KO approves with the notes received (total ≤ amount); any difference goes back to left in bank |

While a step is open, the amount is in `cashInTransit` (pool view, dashboard, heartbeat), so every other KO already sees the lower cash in account. A KO can cancel an open step: the money (and notes) go back where they came from. A step is never shared between KOs. **One open settlement per KO at a time** (step 1 or step 2): a second one gets 409 `This agent already has an open settlement. Approve or cancel it first.`

**Left in bank** (`cashLeftInBank` on the pool view and dashboard cash totals; `leftInBank` per settlement step): what step 2 didn't deliver. Show it **separately** from cash in account and "in bank". A KO brings it back into its cash in hand with a `BANK_TO_HAND` settlement from the desktop; the CSP can also correct it with an ADJUSTMENT (`cashLeftInBank`).

**`GET /cash-management/settlements`** (CSP, BC, super admin): the feed. Query: `agentId` (as for the pool), `agentIds`, `status` (`PENDING`, `APPROVED`, `CANCELLED`), `period` / `from` / `to`, `page`, `limit`. Item: `{ id, cspAgentId, agentId, agentName, direction, step (TO_BANK|FROM_BANK), label ("Cash in account → bank", …), status, amount, settledAmount, leftInBank (step 2: amount − settledAmount), drawer, needsDenomination, parentId (step 2 → step 1), remarks, requestedBy, reviewedBy (machineCode), reviewedAt, createdAt }` + `pagination`. `openSettlements` on the pool view is the badge count. Every money move is also in the ledger as `SETTLEMENT_TO_BANK`, `SETTLEMENT_FROM_BANK`, `SETTLEMENT_HELD` (left in bank held for a `BANK_TO_HAND`), `SETTLEMENT_CANCELLED` (with `settlementId`, `cashInTransitChange`, `balanceCashInTransit`).

The CSP's own `SETTLEMENT` above (`POST /cash-management/transactions`) still works for direct moves (e.g. the CSP's own cash in hand). It's in the audit like every CSP action (`actorType: USER`). An ADJUSTMENT must account for what's in bank and left in bank: cash in account + all cash in hand + in bank + left in bank = limit.

### KO change requests

A KO can't change its cash itself. From the desktop it asks for a new cash in hand (and drawer), and the CSP approves or rejects it.

- `GET /cash-management/requests?status=PENDING|APPROVED|REJECTED&agentId=&page=&limit=` → items `{ id, cspAgentId, agentId, requestedCashInHand, systemCashInHand (at the time of the request), requestedDrawer, reason, status, requestedBy (machineCode), reviewedBy, reviewedAt, reviewRemarks, createdAt }`. `pendingRequests` on the pool view is the badge count.
- `POST /cash-management/requests/:requestId/review` (CSP) `{ "action": "APPROVE" | "REJECT", "remarks"? }`. Approving sets the KO's cash in hand to the requested value; the difference comes from (or goes back to) cash in account. Errors: 400 `Not enough cash in account to approve: …` (the request stays pending); 409 `This request has already been reviewed.`; 404 `Cash request not found.`

### Screens (suggested)

- **Cash (CSP):** limit, cash in account, in bank, total cash in hand; a card per agent (cash in hand, drawer, mismatch badge); "Settle" and "Adjust" actions; a "Requests" badge; a "Settlements" feed with an open count; a "To fix" list (ledger `types=RECEIPT_NOT_APPLIED`).
- **Cash (BC, read-only):** the same view per CSP.
- **Ledger:** filters for agent(s), type and period.

## 14. Reports

`GET /reports/summary?period=TODAY|YESTERDAY|CURRENT_MONTH|LAST_MONTH|CUSTOM&from=&to=&cspAgentId=&agentId=` (default `TODAY`). Sending `from`/`to` overrides `period`; `CUSTOM` without dates = all time. `CURRENT_MONTH` = 1st of this month → today, `LAST_MONTH` = the whole previous month (IST days, §18). Older builds ignored `period` and returned all-time totals.

Rows: **one per CSP, counting the CSP and all its KOs** (older builds left the KOs' transactions out). `agentId` / `cspAgentId`: a CSP → that CSP's row (with its KOs); a KO → a row for that KO only. `/reports/export` follows the same rules.
→ array, one row per agent: `{ agentId, agentName, cashDepositCount, cashDepositAmount, cashWithdrawalCount, cashWithdrawalAmount, moneyTransferCount, moneyTransferAmount, fundTransferCount, fundTransferAmount, miniStatement, balanceEnquiry, passbookPrint, socialSecurity, pmjjby, pmsby, apy, otherSocialSecurity, accountOpening, successTransactions, failedTransactions, totalTransactions, openingBalance, closingBalance }`.

`GET /reports/export` (same query) → Excel (§17).

UI: period chips; horizontal-scroll table (`FlatList` with sticky first column) or a card per agent; totals row computed client-side.

## 15. Metrics (manual entries)

Metric definitions are managed by the Super Admin. BCs enter daily values for **manual** metrics (e.g. social-security enrolments) for their CSPs; they show in the dashboard `socialSecurity` sections.

| Call | Who | Notes |
|---|---|---|
| `GET /metrics` | any | `[{ id, code, name, category, source (RECEIPT\|MANUAL), inputType, description, isActive }]` |
| `GET /metrics/values?agentId=&metricId=&from=&to=` | any (scoped) | entered values |
| `POST /metrics/values` `{ metricId, agentId, date, value ≥ 0 }` | BC | |
| `PATCH /metrics/values/:valueId` `{ value }` | BC | |

Errors: `Metric not found.`, `Metric is inactive.`, `Values can only be entered manually for manual metrics.`, `Manual metric values can only be assigned to a CSP.`, `Metric value already exists for this CSP and date.` (→ offer to edit the existing value).

UI: pick CSP + date, list active `MANUAL` metrics with number inputs, save one by one (no bulk endpoint).

## 16. CSP visits (photo upload)

A BC records **one visit per CSP per calendar month** with a photo and at least 5 customer reviews.

**Flow:**

```
1. pick/take photo → resize/compress to JPEG ≤ 5 MB
2. POST /uploads/presigned-url { fileName: "visit.jpg", contentType: "image/jpeg" }
     → { key, uploadUrl, fields }
3. POST multipart to uploadUrl: every entry of `fields` first, then `file` LAST
4. POST /csp-visits { cspAgentId, visitDate, photoUrl: key, latitude?, longitude?, remarks?, customerReviews: [≥5] }
```

```ts
const { data } = await api.post("/uploads/presigned-url", { fileName: "visit.jpg", contentType: "image/jpeg" });
const form = new FormData();
Object.entries(data.data.fields).forEach(([k, v]) => form.append(k, v as string));
form.append("file", { uri: photo.uri, name: "visit.jpg", type: "image/jpeg" } as any); // must be last
const s3 = await fetch(data.data.uploadUrl, { method: "POST", body: form });       // 204 = uploaded
if (!s3.ok) throw new Error("Photo upload failed");
await api.post("/csp-visits", { cspAgentId, visitDate: new Date().toISOString(), photoUrl: data.data.key, customerReviews, latitude, longitude });
```

- Presign: `contentType` must be `image/jpeg`, `image/png` or `image/webp` and match the extension (`.jpg/.jpeg/.png/.webp`); the URL expires in **5 minutes**; max **5 MB**. Upload right after presigning.
- The key looks like `csp-visits/<yourAgentId>/2026/10/<uuid>.jpg`. Only your own keys are accepted.
- Visit body: `customerReviews: [{ customerName? (≤200), customerAccount? (≤100), review? (≤2000) }]`, **min 5** (`At least 5 customer reviews are required.`); `latitude` −90..90, `longitude` −180..180 (use `expo-location`, optional); `remarks` ≤ 2000.
- Errors: `A CSP visit has already been recorded for this month.`, `Invalid CSP agent.`, `Invalid CSP visit photo.`, `CSP visit photo was not found in storage.` (upload failed or the key is wrong).
- `GET /csp-visits/csp/:cspAgentId?from=&to=` list; `GET /csp-visits/:id` detail, where `photoUrl` is a **signed download URL valid 5 minutes** (load it immediately; don't cache the URL).
- Discarded photo: `DELETE /uploads` `{ key }`.

## 17. File downloads (Excel)

`GET /receipts/export` and `GET /reports/export` return an `.xlsx` file (`Content-Disposition: attachment`), not JSON.

```ts
const target = FileSystem.documentDirectory + `report-${Date.now()}.xlsx`;
const res = await FileSystem.downloadAsync(`${API_BASE_URL}/api/v1/reports/export?period=CURRENT_MONTH`, target, {
  headers: { Authorization: `Bearer ${token}` },
});
if (res.status !== 200) throw new Error("Export failed");   // error bodies are JSON; read them for the message
await Sharing.shareAsync(res.uri, { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
```

## 18. Dates, money and formatting

- Send dates as ISO-8601 UTC (`dayjs(...).toISOString()`); display in `Asia/Kolkata`.
- **Day boundaries are IST** on the server: "today", report periods, monthly CSP detail, chart labels and the one-visit-per-month rule all use the `Asia/Kolkata` calendar. Send `from`/`to` either as dates (`2026-10-25`) or as instants (`2026-10-24T18:30:00.000Z`); the server expands them to whole IST days.
- Money: some fields are numbers, some strings (`price`, `amountPaid`, payment amounts, BC monitoring float). Always `Number(x)` and format `₹` with `toLocaleString("en-IN", { maximumFractionDigits: 2 })`.
- `null` ≠ 0: `null` amount/float means "not applicable / not in your plan".

## 19. Known backend gaps

| Gap | Impact on the app | Plan |
|---|---|---|
| No refresh-token endpoint yet; access token lasts 15 min | users re-login every 15 min | planned `POST /auth/refresh` (§5.2) |
| No resend-OTP / forgot-password endpoints yet | resend = signup again; no password reset | planned (§5.2) |
| Payments are manual (no Razorpay yet) | don't ship checkout to production | checklist 1.1–1.5 |
| No push notifications / activation emails yet | poll lists for link approvals and machine status; show passwords from the assign response | planned (§5.2) |
| `POST /auth/check-agent` returns the full agent record | only use `success` | backend to trim |
| No unlink endpoint for BC↔CSP | can't undo a link from the app | Super Admin/backend |
| `cashLimit`/`openingCash` are ignored when an existing CSP is requested via `POST /agents/csp` | the CSP keeps its own values | by design for now |

## 20. Changelog

- 2026-11-02 (rev 15) — §13A: KO settlement direction `BANK_TO_HAND` (left in bank → cash in hand, one step, deducted from cash left in bank and held until approved); ledger type `SETTLEMENT_HELD`.

- 2026-11-02 (rev 14) — §13A: step 2 of a KO settlement can deliver less in both directions; the rest is **left in bank** (`cashLeftInBank` on the pool view and dashboard, `leftInBank` per step), shown separately and cleared by the CSP with ADJUSTMENT `cashLeftInBank`. One open settlement per KO (409). The CSP's direct SETTLEMENT stays, audited. Ledger items add `cashInTransitChange`, `cashLeftInBankChange`, `balanceCashInTransit`, `balanceCashLeftInBank`, `settlementId`.

- 2026-11-02 (rev 13) — §13A: KO settlements from the desktop in two steps the KO approves itself (account → bank → hand, hand → bank → account); money in between is held in bank (`cashInTransit`); the CSP is only informed: `GET /cash-management/settlements`, `openSettlements` on the pool view; new ledger types.

- 2026-11-02 (rev 12) — §13A: a KO's PC activation counts its cash in hand and drawer (ledger type `ACTIVATION`); cash in account adapts.
- 2026-11-02 (rev 11) — New §13A cash management: one cash limit and cash in account per CSP shared with its KOs, cash in hand and drawer per agent; settle / adjust, audit ledger, KO change requests. Signup and BC CSP creation: cash in hand + cash in account = limit, all three required for a new CSP; KOs only send cash in hand. Dashboard summary adds `cash`.

- 2026-11-01 (rev 10) — CSP signup requires `cashInHand`, `cashInAccount` (holding) and `cspLimit`; the server opens the float and its OPENING ledger entry (`data.openingFloat`). New agent field `openingCashInAccount`; `cashLimit` is only the CSP limit (it was used as the opening cash in account before).
- 2026-11-01 (rev 9) — Dashboard/analytics `agentId`: a CSP shows itself + all its KOs, a KO only itself (analytics ignored it before). New `servicesByCategory` in the summary. Reports count KO transactions on their CSP's row; `agentId`/`cspAgentId` now applied. `passbookPrinter` is counted (was always 0). Receipts list/stats/export: `agentIds`, `receiptTypes`, `transactionCategories` (several values) and `period`.
- 2026-11-01 (rev 8) — The receipt retention period is set by the super admin (15–365 days, default 60); texts in §11 and §13 no longer assume 60.
- 2026-10-31 (rev 7) — Receipt retention: receipts kept 60 days, daily counts 1 year. Dashboards, analytics (day and longer), CSP detail, reports, machine stats and `/receipts/stats` (without `search`) read the counts; transaction list/detail/export, recent transactions and hourly charts cover 60 days (§11, §13).
- 2026-10-30 (rev 6) — Login errors documented (unknown ID and wrong password both `403 Invalid credentials.`); `POST /agents/csp` / `/agents/ko` validate the body (400); invalid query strings / malformed JSON now 400 instead of 500.
- 2026-10-30 (rev 5) — Revoke now needs super admin approval: `POST /activations/:id/revoke-requests`, list/detail/cancel, `pendingRevokeRequest` on activations (the direct `/revoke` is super admin only). Payment retry policy (§6); `verify` retries return 200.
- 2026-10-30 (rev 4) — `create-order` takes an `Idempotency-Key` header (no double payments); 429 rate limits; `POST /activations/:id/revoke`; new receipt values `PASSBOOK` / `PASSBOOK_PRINTING`; `receiptId` unique per agent; report rows add `passbookPrint`, `socialSecurity`, `pmjjby`, `pmsby`, `apy`, `otherSocialSecurity`.

- 2026-10-25 (rev 3) — CSP plans are **per machine** (`machineCount` on create-order; renewal needs the same count). Activation list/detail include `activationPassword` in dev (removed before production). Day boundaries are IST. Planned endpoints listed (§5.2): resend OTP, forgot/reset password, refresh token, push devices, activation email. Activation code format `XXXX-XXXX-XXXX-XXXX`.
- 2026-10-25 (rev 2) — Rewritten as the full React Native KT (was `frontend-integration-changes.md`): architecture, every BC/CSP API with validation, errors and UI logic. Approval links the CSP **and its KOs** (`linkedKoAgentIds` in the admin response, `koCount` in search). CSPs without a BC can create KOs. ₹799-linked CSPs are view-only for the BC. Activation responses no longer include the password hash. CSP visit photos with owner-folder keys are accepted. Reports now apply `period` (was ignored: every period returned all-time totals). Super Admin parts moved to `docs/admin-web-kt.md`.
- 2026-10-25 (rev 1) — BC ₹799 plan, link requests, `POST /agents/csp` 202, plan pricing.
