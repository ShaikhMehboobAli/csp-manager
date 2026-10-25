# CSP Manager Mobile App (React Native) — KT

**Audience:** the React Native team building the CSP Manager mobile app for **BC** and **CSP** users.
**Not covered here:** the Super Admin console (React / Next.js) → `docs/admin-web-kt.md`; the Windows desktop app → `docs/desktop-integration-changes.md`.
**Backend source of truth:** `csp-manager/apps/api` (Express + Prisma + PostgreSQL).
**Last updated:** 2026-10-25 (rev 2)

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
| CSP | `CSP_AUTOMATION` | ₹250/month | 1 | `DESKTOP_AUTOMATION`, `RECEIPT_SYNC` |
| CSP | `CSP_AUTOMATION_CASH_MANAGEMENT` | ₹450/month | 1 | + `CASH_MANAGEMENT` |
| CSP | `CSP_COMPLETE` | ₹550/month | 1 | + `CASH_MANAGEMENT`, `MOBILE_TRACKING` |
| BC | `BC_BASIC` | ₹199/month | 1 | desktop features + `CASH_MANAGEMENT`, `MOBILE_TRACKING` |
| BC | `BC_PRO` | ₹399/month | 5 | same |
| BC | `BC_CSP_LINK` | ₹799/month, ₹4794/6 months, ₹9588/year | **0** | `CSP_LINKING`, `CASH_MANAGEMENT` |

Machine plans give activation codes (one per machine) that the BC/CSP assigns to an agent and types into the desktop app. `BC_CSP_LINK` gives no machines; instead the BC links CSPs that already pay for their own plan (section 10).

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
| 409 | conflict (already pending, already reviewed, OTP errors) | show `message` |
| 5xx / network | server/network problem | retry button; keep cached data visible |

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

→ 201 `Signup successful. OTP sent for verification.` `data: { userId }`.
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

Errors: 404 `User not found.`; 403 `Please verify your account first.` (→ OTP screen), `Your account has been blocked.`, `Your account has been suspended.`, `Invalid credentials.`

### 5.2 Session

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
| `POST /payments/create-order` `{ planId, billingCycle }` | creates a pending payment |
| `POST /payments/verify` `{ paymentId, gatewayTransactionId, transactionReference? }` | completes it, creates/extends the subscription |
| `GET /payments/history`, `GET /payments/:paymentId` | own payments only |

Plan: `{ id, code, name, ownerType, level, machineLimit, pricing: [{ billingCycle, durationDays, price }], features: [{ code, name, description, category }] }` (`price` is a **string**).
Current subscription: `{ id, subscriptionNumber, status, subscriptionType, machineLimit, amountPaid (string), startDate, endDate, graceEndsAt, plan: { id, code, name, ownerType, level }, latestPayment: { paymentNumber, status, amount, totalAmount, paidAt } }`.
`create-order` returns the payment: `{ id, paymentNumber, amount, totalAmount, currency: "INR", status: "PENDING", planId, billingCycle, … }`.

**Purchase rules (server):**
- Same plan while it's running → **renewal**: the end date is extended from the current end date.
- Different plan → **upgrade/switch**: a new subscription starts now and the old one ends immediately. Machines already activated move to the new plan (up to its machine limit). No refund/credit for unused days.
- After the plan ended → new subscription from now. No grace period.
- Buying a plan of the wrong owner type → 400 `This plan is not available for your account.`; unknown cycle → 400 `Selected billing cycle is not available.`

**Payment status — PENDING backend work:** today the payment is "manual": the app calls `create-order` and then `verify` with any `gatewayTransactionId`. Razorpay is being integrated (pre-production checklist 1.1–1.5). Build the checkout behind one function `payForPlan(planId, billingCycle)` so swapping in `react-native-razorpay` later only changes that function. Don't ship the manual flow to production users.

**UI notes:** plan cards list every `pricing` entry (cycle selector). Show "Renews on `endDate`". Switching a machine plan to `BC_CSP_LINK` (0 machines) must warn: "Your machines will stop working."

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

Buying a machine plan creates one activation per machine (`machineLimit`). The owner **assigns** an activation to an agent, gets a one-time **password**, and the person at the PC types `agentId` + activation code + password into the desktop app.

| Call | Who | Notes |
|---|---|---|
| `GET /activations` | owner | all activations of the owner's subscriptions |
| `GET /activations/:activationId` | owner | adds `canRegenerate` |
| `POST /activations/assign` `{ activationId, assignedAgentId }` | owner | returns `{ activationCode, activationPassword }` **once** |
| `POST /activations/:activationId/regenerate-password` | owner | only while `NOT_ACTIVATED`; returns a new password once |

Activation: `{ id, activationCode, status, expiresAt, assignedAgentId, assignedAt, activatedAt, isCurrent, machine: { machineCode, machineName, status, isOnline, lastHeartbeatAt } | null, subscription: { subscriptionNumber, endDate } }`. `status`: `NOT_ACTIVATED`, `ACTIVE`, `INACTIVE`, `REVOKED`, `TRANSFERRED`.

**Who can be assigned:**
- **CSP owner:** itself or one of **its KOs** (`CSP can assign only to KO.`, `KO does not belong to this CSP.`).
- **BC owner:** any agent whose BC is this BC (`Agent does not belong to this BC.`).

Other errors: `Activation not found.` (404), `Activation has already been used.`, `Activation is already assigned.`, `Agent is inactive.`, `Activation password cannot be regenerated.`

**UI:** list grouped by status. On assign/regenerate show code + password in a modal with **Copy** and **Share** buttons and the warning "This password is shown only once". Never store the password. A BC on `BC_CSP_LINK` has no activations: show "This plan doesn't include machine activations".

## 9. Agents: CSPs and KOs

| Call | Who | Notes |
|---|---|---|
| `GET /agents?type=CSP\|KO&parentAgentId=&page=&limit=` | any | limited to your scope; `limit` ≤ 100, default 10 |
| `GET /agents/:agentId` | any | in scope only |
| `POST /agents/csp` | BC | create a new CSP, or request to link an existing one |
| `POST /agents/ko` | CSP | create a KO, or link an existing unlinked KO |
| `PATCH /agents/:agentId` | owner | `{ name?, mobile?, email?, address?, cashLimit?, openingCash?, status? (ACTIVE\|INACTIVE) }` |
| `DELETE /agents/:agentId` | owner | soft delete |

Agent: `{ id, agentId, name, type, mobile, email, address, bcId, parentAgentId, cashLimit (string\|null), openingCash (string\|null), linkedAt, createdAt, updatedAt }`.

**`POST /agents/csp` (BC)** body: `{ agentId, name, mobile?, email?, address?, cashLimit?, openingCash?, machineCount, kos?: [{ agentId, name, mobile?, email?, address?, cashLimit?, openingCash?, machineCount }] }`

| Case | Response |
|---|---|
| new CSP id | **201** `CSP created successfully.` `data: { csp, kos }` (opening float recorded from `openingCash`) |
| existing, unlinked CSP | **202** `This CSP already exists. A link request was sent to the admin for approval.` `data: { csp: null, kos: [], linkRequest }` |
| CSP linked to another BC | **202** `This CSP is linked to another BC. A link request was sent to the admin for review.` (`linkRequest.isConflict = true`) |
| already linked to you | 400 `CSP is already linked with this Business Correspondent.` |
| existing CSP **with `kos`** | 400 `Add KOs after the CSP link is approved.` |
| id belongs to a KO/BC | 400 `Provided Agent ID does not belong to a CSP.` |
| pending request exists | 409 `A link request for this CSP is already pending.` |

Handle **202 separately**: `csp` is `null`; show a success toast and open "Link requests" (§10). The CSP and its KOs appear in your data only after approval.

**`POST /agents/ko` (CSP)** body: `{ agentId, name, mobile?, email?, address?, cashLimit?, openingCash?, machineCount }` → 201 `KO created successfully.` `data: { ko }`. Works for every CSP (with or without a BC). Errors: `KO is already linked with this CSP.`, `KO is already linked with another CSP.`, `Provided Agent ID does not belong to a KO.`

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

**`GET /dashboard/summary`** query (all optional): `from`, `to` (ISO dates; default today), `agentId` (one agent in scope), `machineId`, `receiptType`, `transactionCategory`, `search`. `from` must be ≤ `to`.

Common fields:

```
overview:          { totalTransactions, successfulTransactions, failedTransactions, totalTransactionAmount, lastTransactionAt, successRate, failureRate }
services:          [{ transactionCategory, receiptType, successCount, failedCount, successAmount, failedAmount }]
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

`GET /receipts` query: `page`, `limit` (≤100, default 20), `from`, `to`, `machineId`, `receiptType`, `transactionCategory`, `status` (`SUCCESS|FAILED|PENDING`), `search`, `agentId`, `sortBy` (`transactionAt|createdAt|amount`), `sortOrder`.

Item: `{ receiptId, receiptType, transactionCategory, status, amount, transactionAt, createdAt, customerName, customerAccount, rrn, stan, agentId, machineCode, machineName }`.

`GET /receipts/:receiptId` (use **`receiptId`**) → `{ …, cashDenomination: { notes500, notes200, notes100, notes50, notes20, notes10, notes5, coins20, coins10, coins5, coins2, coins1 } | null, machine: { machineCode, machineName }, agent: { agentId, name, type } }`. `cashDenomination` is `null` when none was captured or the CSP plan lacks `CASH_MANAGEMENT`.

`GET /receipts/stats` (same filters) → `{ total, success, failed, totalAmount }`.
`GET /receipts/export` (same filters) → Excel file (§17).

Enums for filters:
- `transactionCategory`: `CASH_DEPOSIT`, `CASH_WITHDRAWAL`, `MONEY_TRANSFER`, `FUND_TRANSFER`, `BALANCE_ENQUIRY`, `MINI_STATEMENT`, `ACCOUNT_OPENING`, `BBPS`, `MICRO_ATM`, `SOCIAL_SECURITY`, `LOAN`, `OTHER`
- `receiptType`: `AEPS`, `ACCOUNT`, `CARD`, `BBPS`, `MICRO_ATM`, `ACCOUNT_OPENING`, `APY`, `PMJJBY`, `PMSBY`, `MUDRA_LOAN`, `UNKNOWN`

`amount` is `null` for non-cash categories (balance enquiry, mini statement…): show "—", not ₹0. Only cash deposit, cash withdrawal and money transfer move the float.

## 14. Reports

`GET /reports/summary?period=TODAY|YESTERDAY|CURRENT_MONTH|LAST_MONTH|CUSTOM&from=&to=&cspAgentId=&agentId=` (default `TODAY`). Sending `from`/`to` overrides `period`; `CUSTOM` without dates = all time. `CURRENT_MONTH` = 1st of this month → today, `LAST_MONTH` = the whole previous month (UTC days, §18). Older builds ignored `period` and returned all-time totals.
→ array, one row per agent: `{ agentId, agentName, cashDepositCount, cashDepositAmount, cashWithdrawalCount, cashWithdrawalAmount, moneyTransferCount, moneyTransferAmount, fundTransferCount, fundTransferAmount, miniStatement, balanceEnquiry, accountOpening, successTransactions, failedTransactions, totalTransactions, openingBalance, closingBalance }`.

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
- **Day boundaries are UTC on the server** (gap §19): "today" on the dashboard is 00:00–23:59 UTC = 05:30–05:29 IST. Until fixed, label ranges plainly and don't promise "since midnight".
- Money: some fields are numbers, some strings (`price`, `amountPaid`, payment amounts, BC monitoring float). Always `Number(x)` and format `₹` with `toLocaleString("en-IN", { maximumFractionDigits: 2 })`.
- `null` ≠ 0: `null` amount/float means "not applicable / not in your plan".

## 19. Known backend gaps

| Gap | Impact on the app | Plan |
|---|---|---|
| No refresh-token endpoint; access token lasts 15 min | users re-login every 15 min | backend to add `POST /auth/refresh`; keep `refreshToken` stored |
| No resend-OTP / forgot-password endpoints | resend = signup again; no password reset | backend |
| Payments are manual (no Razorpay yet) | don't ship checkout to production | checklist 1.1–1.5 |
| Day boundaries are UTC | early-morning IST transactions fall on the previous day | backend decision |
| No push notifications | poll lists for link approvals and machine status | future |
| `POST /auth/check-agent` returns the full agent record | only use `success` | backend to trim |
| No unlink endpoint for BC↔CSP | can't undo a link from the app | Super Admin/backend |
| `cashLimit`/`openingCash` are ignored when an existing CSP is requested via `POST /agents/csp` | the CSP keeps its own values | by design for now |

## 20. Changelog

- 2026-10-25 (rev 2) — Rewritten as the full React Native KT (was `frontend-integration-changes.md`): architecture, every BC/CSP API with validation, errors and UI logic. Approval links the CSP **and its KOs** (`linkedKoAgentIds` in the admin response, `koCount` in search). CSPs without a BC can create KOs. ₹799-linked CSPs are view-only for the BC. Activation responses no longer include the password hash. CSP visit photos with owner-folder keys are accepted. Reports now apply `period` (was ignored: every period returned all-time totals). Super Admin parts moved to `docs/admin-web-kt.md`.
- 2026-10-25 (rev 1) — BC ₹799 plan, link requests, `POST /agents/csp` 202, plan pricing.
