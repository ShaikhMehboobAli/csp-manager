# CSP Manager Mobile App (React Native) — KT

**Audience:** the React Native team building the CSP Manager mobile app for **BC** and **CSP** users.
**Not covered here:** the Super Admin console (React / Next.js) → `docs/admin-web-kt.md`; the Windows desktop app → `docs/desktop-integration-changes.md`.
**Backend source of truth:** `csp-manager/apps/api` (Express + Prisma + PostgreSQL).
**Last updated:** 2026-11-07 (rev 27)

> Describes the backend once PRs #3–#8 are merged into `development`. Where an older build behaves differently it says so.
>
> **Rev 27 (2026-11-07), owner decisions:** (1) the plan is **blocked while the renewal is being charged / retried** (`state: RENEWAL_PENDING`, new 403 `RENEWAL_PENDING`, §6A.4, §7.2); (2) when the super admin changes a plan's price, running mandates are **replaced by a new mandate at the new price** (notification `MANDATE_REPLACED`, §6A.3); (3) a purchase after a cancel **starts now** (confirmed, §6A.5). A purchase while the renewal is being charged → 409 `RENEWAL_IN_PROGRESS`. CSP plans have **no grace period** any more.

> **Rev 26 (2026-11-07) changes a lot: read §0 first.** Plans are now ₹250 / ₹550 only; a lapsed or ₹250 plan blocks most tabs (§7); subscriptions renew by **UPI mandate** and can only be **upgraded** (difference only, first 12 days) or **cancelled** (§6A); the cash limit is **worked out, never entered** (§5.1, §9, §13A); KO creation moves cash in hand between agents (§9.1); the CSP can increase / decrease cash (§13A.10); every cash in hand change makes a mandatory **Adjust** request on the desktop (§13A.11).

---

## Contents

0. **Rev 26 at a glance (read first)**
1. Product in one page
2. App architecture (recommended stack)
3. API conventions (client, errors, auth header)
4. Roles and navigation
4A. **Full flow by role (start here)**: CSP and BC, step by step
4B. **Every API the app uses, by role**: one table per area, plus what each tab calls
5. Auth: signup, OTP, login, session
6. Plans, subscription and payment
6A. **Subscription rules (rev 26): upgrade, cancel, UPI mandate, auto renewal**
7. **Paywall, plan blocking and feature gating (rev 26: which screens are blocked when)**
8. Activations (machine codes for the desktop app)
9. Agents: CSPs and KOs
10. BC ₹799: link existing CSPs (with their KOs)
11. Dashboard
12. Machines
13. Transactions (receipts)
13A. Cash management (CSP + KOs)
13B. Commission (CSP)
13C. Team today (CSP)
13D. Notifications (rev 26)
14. Reports
15. Metrics (manual entries)
16. CSP visits (photo upload)
17. File downloads (Excel)
18. Dates, money and formatting
19. Known backend gaps (19.1 requirements from the mobile app, 19.2 endpoints for the v2 screens)
20. Changelog

---

## 0. Rev 26 at a glance (read first)

| # | Change | What the app does | Section |
|---|---|---|---|
| 1 | **₹450 plan removed.** CSP plans: `CSP_AUTOMATION` ₹250 (desktop automation only) and `CSP_COMPLETE` ₹550 (everything: automation, cash management, the app's dashboard / machines / cash / reports). | Plan list shows two CSP plans (it comes from the API). Running ₹450 subscriptions keep working until they end and can upgrade to ₹550. | §1, §4A.2 |
| 2 | **Plan blocking.** Without a running subscription, only KO management, payments, plan history and subscribe / renew stay open: every other tab shows a **non-closable popup** "Please renew or take a new plan." On ₹250, dashboard / machines / cash / reports show **"Please upgrade the plan."** | Call `GET /subscriptions/access` on launch / resume / after payment and build the tab bar from `screens`. Handle 403 `SUBSCRIPTION_REQUIRED` / `PLAN_UPGRADE_REQUIRED` on any call. | §7 |
| 3 | **Upgrade only, difference only, first 12 days.** A running subscription can't be downgraded or have fewer machines (cancel and buy a new one). An upgrade (higher plan and/or more machines) charges `(new price − old price) × old machines + new price × added machines` + GST; the end date doesn't move. Only in the first 12 days of the purchase or the last renewal. | Use `POST /subscriptions/quote` to show the amount; `create-order` does the same maths. Disable plans / machine counts below the current ones. | §6A.2 |
| 4 | **UPI mandate, auto renewal, 2 retries, stop.** Every CSP purchase sets up a monthly UPI autopay mandate (25 years). It charges the monthly amount at the plan's end date/time. A failed charge is retried twice, 15 min apart; after the 3rd failure the plan **stops at once** (state `LAPSED`). From the end date until a charge succeeds the plan is **blocked** (state `RENEWAL_PENDING`, rev 27). A plan price change replaces the mandate with one at the new price (rev 27). | Show mandate status and next charge on the Subscription screen; on `RENEWAL_PENDING` / `LAPSED` / `EXPIRED` the blocking popup takes over. | §6A.3–6A.4 |
| 5 | **Cancel = no refund, works till the end date, mandate cancelled.** | "Cancel subscription" on the Subscription screen → `POST /subscriptions/current/cancel`. | §6A.5 |
| 6 | **One activation per agent.** An agent (KO or the CSP) that already has a code assigned (unused) or running on a PC can't get another: 400 `AGENT_ALREADY_HAS_ACTIVATION`. | In the assign sheet, list only agents without an activation. | §8 |
| 7 | **Cash limit = worked out.** Signup asks only cash in hand + cash in account (`cspLimit` ignored). Limit = all cash in hand + cash in account + in bank + left in bank + balance due − other cash. Nothing is ever compared with it. ADJUSTMENT `cashLimit` is refused. | Remove the limit field everywhere; show it read-only. | §5.1, §13A |
| 8 | **KO creation moves cash in hand.** The CSP enters the KO's cash in hand; the form lists the CSP and the other KOs with their cash in hand (editable). By default it's taken from the CSP's own cash in hand; what isn't covered raises the limit. | New KO form (only on a plan with cash management). | §9.1 |
| 9 | **KO activation difference.** The desktop pre-fills the cash in hand the CSP gave; if the KO counts a different amount it says where the difference came from / went to (cash in account or other); "other" moves the limit and **notifies the CSP**. | Show the notification (§13D) and the ledger row (`ACTIVATION`, `reason`). | §13A.12 |
| 10 | **Increase / decrease and direct edit.** New button: increase / decrease an agent's cash in hand (the CSP's own only when it has a running PC) or the cash in account; the limit moves. Direct edit of any agent's cash in hand / the cash in account stays (ADJUSTMENT), audited. | New sheet; ledger types `INCREASE` / `DECREASE`. | §13A.10 |
| 11 | **Adjust requests.** Every cash in hand change the CSP makes (KO creation, edit, increase / decrease) creates a mandatory **Adjust** request for that agent on the desktop: it counts the notes given / taken. | Show "waiting for notes" per agent (`pendingAdjustments`), list in `GET /cash-management/adjustments`. | §13A.11 |
| 12 | **Replace KO; delete KO.** `POST /agents/:agentId/replace` moves the old KO's machine and cash management to a new KO. Deleting a KO removes its cash in hand from the pool (limit goes down). | New "Replace KO" action. | §9.2–9.3 |
| 13 | **Shared PCs.** Any KO of the CSP (and the CSP) can work on any PC of the CSP; cash management follows whoever logs in to SBI. KOs' emails are verified by OTP on the desktop. | Ask for the KO's email in the KO form (needed for the desktop cash login). `PATCH` with a new email resets its verification. | §9.4 |
| 14 | **Failed transactions aren't recorded.** A receipt SBI shows as failed is skipped by the server (no count, commission, cash). | Nothing to change; numbers are just right. | — |
| 15 | **Notifications.** `GET /notifications`, `POST /notifications/:id/read` (activation difference, renewal, renewal failed, lapsed, cancelled, mandate removed). | Bell icon + list. | §13D |

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
| CSP | `CSP_AUTOMATION` | ₹250 per machine/month | chosen at checkout (1–100) | `DESKTOP_AUTOMATION`, `RECEIPT_SYNC` (desktop automation only; the app only manages KOs, codes and billing) |
| CSP | `CSP_COMPLETE` | ₹550 per machine/month | chosen at checkout | + `CASH_MANAGEMENT`, `MOBILE_TRACKING` (desktop cash management + the app's dashboard, machines, cash, reports) |
| ~~CSP~~ | ~~`CSP_AUTOMATION_CASH_MANAGEMENT`~~ | ~~₹450~~ | — | **Removed in rev 26** (inactive; not in the plan list). A running one keeps working until it ends and can be upgraded to `CSP_COMPLETE`. |
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
**Error:** `{ "success": false, "code": "…", "message": "…" }`. Show `message` as-is (it's user-readable). Decide on **`code`** (stable, e.g. `VALIDATION_FAILED`, `PLAN_NO_CASH_MANAGEMENT`, `INSUFFICIENT_CASH_IN_ACCOUNT`, `RATE_LIMITED`, `NOT_FOUND`); it doesn't change when a message is reworded. Codes the app meets most: `VALIDATION_FAILED` (400, field error), `TOKEN_EXPIRED` / `TOKEN_INVALID` / `TOKEN_REQUIRED` (401 → refresh, §5.3), `REFRESH_TOKEN_INVALID` (401 on refresh → Login), `ACCOUNT_NOT_VERIFIED` (→ OTP screen), `INVALID_CREDENTIALS`, `ACCOUNT_EXISTS`, `OTP_INVALID` / `OTP_EXPIRED` / `OTP_ATTEMPTS_EXCEEDED` / `OTP_NOT_FOUND` / `OTP_RESEND_TOO_SOON` / `OTP_RESEND_LIMIT`, the subscription codes `SUBSCRIPTION_NONE` / `SUBSCRIPTION_EXPIRED` / `SUBSCRIPTION_SUSPENDED` / `SUBSCRIPTION_CANCELLED` / `SUBSCRIPTION_PENDING` / `SUBSCRIPTION_NOT_STARTED` (403 → Paywall), `PLAN_FEATURE_MISSING` (403 → upgrade prompt), `UNAUTHORIZED` (401), `FORBIDDEN` (403; subscription messages → Paywall), `PLAN_NO_CASH_MANAGEMENT` (403 → upgrade prompt), `NOT_FOUND` (404), `CONFLICT` and the specific 409 codes (`REQUEST_ALREADY_REVIEWED`, `LABEL_NAME_TAKEN`, …), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500). Where no specific code fits, `code` is the status name.

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
    const code = error.response?.data?.code ?? "NETWORK";
    if (status === 401) await session.expire();               // clear + navigate to Login
    if (status === 403 && code.startsWith("SUBSCRIPTION_")) paywall.open(message);
    return Promise.reject(new ApiError(status, code, message));
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
| CSPs | CSP list (agents); add CSP (₹199 / ₹399 machine plans only); link CSP + link requests (₹799 only) | §9, §10 |
| Machines | machine monitoring | §12 |
| Reports | summary, export, transactions | §13, §14 |
| More | subscription & payments, activation codes (hidden on ₹799), CSP visits, metric entries, profile | §6, §8, §15, §16 |

Show/hide by plan: read the current plan's features (section 7).

## 4A. Full flow by role (start here)

This is the whole app in the order a user meets it, for a **CSP** and for a **BC**. Each step names the screen, the calls, and what to show. The sections after this one have every field and error.

### 4A.1 Every launch (both roles)

```
App start
 ├─ token in secure storage and not expired (decode `exp`)?
 │    no  → Login (prefill the last agentId)                                   §5
 │    yes → GET /subscriptions/current                                         §6
 │            data = null or status not ACTIVE → Plans / Paywall                §6, §7
 │            ACTIVE → features = current.plan.features[].code              §7
 │                     → open CspTabs or BcTabs (by user.role)                  §4
 └─ any call: 401 → Login ("Session expired"); 403 with a subscription message → Paywall;
    403 `PLAN_NO_CASH_MANAGEMENT` / "does not include this feature" → upgrade prompt
```

- Keep `features` and the current subscription in one store (React Query `["subscription"]`); refetch on app resume, after a payment, and when a 403 subscription message comes back.
- Decide on the error **`code`** (§3), show `message`.
- Rate limits (§3): never retry in a loop.

### 4A.2 What each plan unlocks

**CSP plans** (price per machine per month; the CSP picks the number of machines: its own PC + its KOs' PCs):

| Screen / action (rev 26) | No running plan (none / expired / lapsed) | `CSP_AUTOMATION` ₹250 | `CSP_COMPLETE` ₹550 |
|---|---|---|---|
| KO list, create / edit / delete / replace KO | **yes** | yes | yes |
| Payments, plan history, plan list, subscribe / renew | **yes** | yes | yes |
| Subscription screen: upgrade, cancel | subscribe / renew only | yes | yes |
| Notifications, profile, change password, logout | yes | yes | yes |
| Activation codes: list, assign, revoke request | list only (assign needs a running plan) | yes | yes |
| Dashboard (Home), Team today, commission | **blocked**: non-closable popup "Please renew or take a new plan." | **"Please upgrade the plan."** | yes |
| Machines tab (list, detail, analytics) | blocked (popup) | "Please upgrade the plan." | yes |
| Cash tab (pool, increase / decrease, edit, settlements, requests, labels, dues, day closes, tasks, adjust requests) | blocked (popup) | "Please upgrade the plan." | yes |
| Reports, transactions (receipts), exports | blocked (popup) | "Please upgrade the plan." | yes |
| Desktop: SBI automation | stops: "Please ask your CSP to renew the service or create a new subscription in the mobile app" | yes | yes |
| Desktop: cash management | stops (same text) | not shown ("Please ask your CSP to upgrade…") | yes |

Source of truth: `GET /subscriptions/access` (§7). The server enforces the same rules (403 `SUBSCRIPTION_REQUIRED` / `PLAN_UPGRADE_REQUIRED`).

**BC plans:**

| Screen / action | `BC_BASIC` ₹199 (1 machine) | `BC_PRO` ₹399 (5 machines) | `BC_CSP_LINK` ₹799 (0 machines) |
|---|---|---|---|
| Add CSPs (+ KOs) it manages (`POST /agents/csp`) | yes | yes | **no**: 403 `PLAN_LINK_ONLY` (hide "Add CSP") |
| Activation codes for its CSPs / KOs | yes | yes | **no**: "This plan doesn't include machine activations" |
| Link CSPs that pay for themselves (search + request, admin approves) | no | no | **yes** (`CSP_LINKING`) |
| Dashboard (with CSP summary + monthly detail), machines, transactions, reports | yes | yes | yes (linked CSPs only while their own plan is active) |
| Cash (read-only, per CSP) | yes | yes | yes |
| Metric entries, CSP visits | yes | yes | yes |

### 4A.3 CSP flow

**A. Sign up and log in** (§5)

```
[Welcome] → [Sign up: CSP]
   name, agentId (bank-issued), email, phone, address, password ×2,
   cashInHand, cashInAccount, cspLimit   (cash in hand + cash in account must equal the limit)
   → POST /auth/signup                         201 → [OTP]  (409 "Account already exists" → Login)
[OTP] 6 digits, 10 min, 5 tries → POST /auth/verify-otp   ("Resend" = POST /auth/signup again)
[Login] agentId + password → POST /auth/login → save accessToken, refreshToken, user
```

The three cash fields open the CSP's cash pool (§13A): they're the starting point of cash management, so validate them before sending.

**B. Choose a plan and pay** (§6)

```
GET /subscriptions/current → null → [Plans] GET /subscriptions/plans?ownerType=CSP
[Plan card] → cycle → machines stepper (1–100; total = price × machines)
  → [Pay]: new Idempotency-Key (UUID), saved with the attempt
  → POST /payments/create-order { planId, billingCycle, machineCount }     → payment PENDING
  → (Razorpay later; today) POST /payments/verify { paymentId, gatewayTransactionId }
  → GET /subscriptions/current → ACTIVE → reload features → [Home]
```

Retries, timeouts and "payment being confirmed" polling: §6. Payments list: `GET /payments/history`, detail `GET /payments/:paymentId`. Plan history: `GET /subscriptions/history`.

**C. Set up KOs and machines** (§8, §9)

```
[More → KOs] → [Add KO] { agentId, name, mobile?, email?, address?, openingCash }
   → POST /agents/ko   (openingCash comes out of the CSP's cash in account; 400 when it can't)
[More → Activation codes] GET /activations   (one per machine bought)
   → [Assign] pick the CSP itself or a KO → POST /activations/assign → modal: code + password (shown once; Copy / Share)
On the PC: the operator types agentId + code + password into the desktop app and counts the drawer → PC appears in Machines
```

Replace a PC or give a code to someone else: **Revoke request** (super admin approves; §8). A Windows reinstall needs nothing: the same PC re-activates with the same code.

**D. Every day** (§11–§14)

| Tab | Screen | Calls |
|---|---|---|
| Home | today's numbers, services tiles, status, recent transactions, float / cash cards | `GET /dashboard/summary` (refetch on focus + every 60 s), charts `GET /dashboard/analytics?groupBy=` |
| Home → pick an agent | the CSP or one KO | same calls with `agentId` |
| Machines | list (online dot), detail, sessions, SBI activity, rename / watcher switch | `GET /machines/list`, `/machines/:id`, `/analytics`, `/activity-sessions`, `/heartbeat`, `PATCH /machines/:id` |
| Transactions | filters (agents, types, categories, period), detail, export | `GET /receipts`, `/receipts/stats`, `/receipts/:receiptId`, `/receipts/export` (§17) |
| Reports | period chips, one row per CSP (+ KOs), export | `GET /reports/summary`, `/reports/export` |

**E. Cash management** (only with `CASH_MANAGEMENT`; §13A)

```
[Cash] GET /cash-management                     → limit, cash in account, in bank, left in bank, other cash,
                                                   extra cash held by dues, each agent's cash in hand + drawer,
                                                   badges: pendingRequests, openSettlements
  ├─ [Settle] (CSP's own direct move)            POST /cash-management/transactions { type: SETTLEMENT, … } + Idempotency-Key
  ├─ [Adjust] (corrections, raise limit, set drawer, clear left in bank / other cash)
  │                                              POST /cash-management/transactions { type: ADJUSTMENT, …, remarks }
  ├─ [Requests] KO asks to correct its cash      GET /cash-management/requests → POST /requests/:id/review { APPROVE | REJECT }
  ├─ [Settlements] the KOs' own (informed only)  GET /cash-management/settlements
  ├─ [Ledger] audit, filters                     GET /cash-management/ledger   ("To fix" = types=RECEIPT_NOT_APPLIED)
  ├─ [Balance due] per KO                        GET /cash-management/dues?status=OPEN|CLOSED
  ├─ [Day closes] today's state + history        GET /cash-management/day-closes
  ├─ [Tasks] per KO; give / edit / delete own    GET|POST /cash-management/tasks, PATCH|DELETE /tasks/:id
  └─ [Settings → Labels] for KOs' custom transactions   GET|POST /cash-management/labels, PATCH /labels/:id
```

A KO does its own cash work on the desktop (settlements, custom transactions, dues, exchange, day close, tasks); the CSP sees all of it here. Push notifications for these aren't built yet (pre-production checklist 2.16): refetch on focus and pull-to-refresh.

**F. Renew, change, expire** (§6, §7)

- Same plan and machines while active → renewal (end date extends). Different machines or plan → new subscription now; activated PCs carry over up to the new count.
- Show "Renews on `endDate`" on More → Subscription. After `endDate` every data call returns 403 `Your subscription has expired.` → Paywall; the desktop PCs stop too.

### 4A.4 BC flow

**A. Sign up and log in** (§5): same as the CSP without the three cash fields (`accountType: "BC"`).

**B. Choose a plan and pay** (§6): `GET /subscriptions/plans?ownerType=BC`; BC plans have a fixed machine count, so **no machine stepper and no `machineCount`** (400 `Machine count can only be chosen for CSP plans.`). Same Idempotency-Key, verify and polling rules.

**C1. Machine plan (`BC_BASIC` / `BC_PRO`, the legacy plans): CSPs the BC manages** (§9, §8)

The BC creates its CSPs (with their KOs) and gives them machines: it assigns the activation codes of **its** subscription to them. Those CSPs still need **their own** CSP subscription to use the app (4A.5).

```
[CSPs] GET /agents?type=CSP
 → [Add CSP] { agentId, name, …, cashLimit, openingCash, openingCashInAccount, kos?: [{ agentId, name, openingCash }] }
      POST /agents/csp
        201 → new CSP (+ KOs) created; its cash pool opened from the three cash values
        202 → the ID already exists: a link request went to the super admin → open [Link requests] (C2)
 → [CSP detail] edit / delete (PATCH / DELETE /agents/:agentId), its KOs (GET /agents?type=KO&parentAgentId=)
[Activation codes] GET /activations → [Assign] to any CSP or KO of this BC → code + password modal
```

**C2. ₹799 plan (`BC_CSP_LINK`): link CSPs that pay for themselves** (§10)

Linking only: this plan **can't create CSPs or KOs** (`POST /agents/csp` → 403 `PLAN_LINK_ONLY` `Your plan links CSPs that have their own subscription; it can't create CSPs or KOs. Use Link CSP instead.`) and has no activation codes. Show "Link CSP" instead of "Add CSP".

```
[Link CSP] search (≥ 2 chars, debounce 300 ms) GET /bc-links/csps/search?search=
   → row: Linked / Request pending / [Send link request] → POST /bc-links/requests { cspAgentId, remarks? }
[Link requests] GET /bc-links/requests?status=  → PENDING → super admin approves / rejects; BC can cancel
   approved → the CSP and all its KOs appear in every BC screen (view only: no edit / delete)
```

A linked CSP drops out of the BC's data while its own plan has lapsed, and comes back when it renews.

**D. Every day** (§11–§16)

| Tab | Screen | Calls |
|---|---|---|
| Home | totals for all CSPs, machine monitoring, CSP summary table (transactions + social security) | `GET /dashboard/summary`, `/dashboard/analytics` |
| Home → CSP | one CSP (+ its KOs), month-by-day table | `GET /dashboard/summary?agentId=`, `GET /dashboard/csp/:agentId/detail?section=transaction\|socialSecurity&month=YYYY-MM` |
| CSPs | list, detail, KOs, add / link (C1 / C2) | `/agents`, `/bc-links/*` |
| Machines | all PCs of its CSPs and KOs | `GET /machines/list`, detail calls as for the CSP |
| Reports | one row per CSP (with its KOs), export; transactions with filters | `/reports/*`, `/receipts/*` |
| Cash (read-only) | a CSP's pool, ledger, dues, day closes, tasks, settlements | the §13A GETs with **`agentId` = the CSP (or a KO)** (400 without it) |
| More → Metrics | daily manual values per CSP | `GET /metrics`, `GET|POST /metrics/values`, `PATCH /metrics/values/:id` (§15) |
| More → CSP visits | one visit per CSP per month: photo + ≥ 5 reviews | `POST /uploads/presigned-url` → S3 → `POST /csp-visits`; `GET /csp-visits/csp/:cspAgentId` (§16) |

**E. Renew, change, expire:** as for the CSP. Moving a machine plan to `BC_CSP_LINK` (0 machines) stops its PCs: warn before paying.

### 4A.5 A CSP that a BC created

A CSP made by a BC (C1) can also get its own login: it signs up with the same `agentId` (signup creates the user for the existing agent). **Its app content needs its own CSP subscription** (product rule): until it buys a CSP plan it sees the Paywall, even though its PCs run on the activation codes the BC assigned from the BC's plan. The cash values it enters at signup replace the BC's opening values only while nothing has been recorded in its pool (`openingFloat: UPDATED`); otherwise they're kept (`KEPT`).

### 4A.6 Build order (suggested)

1. API client, error handling by `code`, secure session (§2, §3, §5).
2. Signup / OTP / login for both roles (§5).
3. Plans, checkout, subscription and paywall, feature store (§6, §7).
4. CSP: KOs, activation codes, revoke requests (§8, §9).
5. Dashboard, machines, transactions, reports, exports (§11–§14, §17).
6. BC: add CSP, link CSP, link requests (§9, §10); metrics, CSP visits (§15, §16).
7. Cash management screens (§13A).

## 4B. Every API the app uses, by role

All paths are under `/api/v1`. **CSP** / **BC** columns: ✓ = allowed, — = not for this role (403), *own* = only its own records, *read* = view only.
**Sub** column: what the server checks before answering:
- *public*: no token;
- *login*: any valid token;
- *active*: an active subscription (403 subscription message → Paywall, §7);
- *cash*: active, plus `CASH_MANAGEMENT` for CSP plans (403 `PLAN_NO_CASH_MANAGEMENT`; BCs always pass);
- *machines*: a BC machine plan (₹199 / ₹399; 403 `PLAN_LINK_ONLY` on ₹799);
- *link*: the ₹799 plan's `CSP_LINKING`.

The last column points to the section with every field and error. Super-admin-only routes (pricing, approvals, metric definitions) and desktop routes (`/machines/activate`, `/machines/runtime/*`, `/receipts/upload*`) are not for the app.

### Auth (§5)

| Method | Path | CSP | BC | Sub | Body → answer | § |
|---|---|---|---|---|---|---|
| POST | `/auth/check-agent` | ✓ | ✓ | public | `{ agentId }` → 200 exists / 404 / 403 KO | 5.1 |
| POST | `/auth/signup` | ✓ | ✓ | public | `{ accountType, name, agentId, email, phone, address, password, confirmPassword }` + CSP: `cashInHand, cashInAccount, cspLimit` → 201 `{ userId, openingFloat }` | 5.1 |
| POST | `/auth/verify-otp` | ✓ | ✓ | public | `{ agentId, otp }` → 200 | 5.1 |
| POST | `/auth/login` | ✓ | ✓ | public | `{ agentId, password }` → `{ accessToken, refreshToken, user: { id, agentId, email, role } }` | 5.1 |
| POST | `/auth/resend-otp` | ✓ | ✓ | public | `{ agentId }` → `{ expiresAt, resendAvailableAt }` (1 per minute, 5 per hour) | 5.2 |
| POST | `/auth/refresh` | ✓ | ✓ | public | `{ refreshToken }` → `{ accessToken, refreshToken (new), user }` | 5.2 |
| POST | `/auth/logout` | ✓ | ✓ | public | `{ refreshToken }` → 200 (ends that session) | 5.2 |
| POST | `/auth/forgot-password` | ✓ | ✓ | public | `{ agentId }` → always 200 `{ resendAvailableAt }` (emails a reset OTP if the account exists) | 5.2 |
| POST | `/auth/reset-password` | ✓ | ✓ | public | `{ agentId, otp, password, confirmPassword }` → 200; every session ends | 5.2 |
| POST | `/auth/change-password` | ✓ | ✓ | login | `{ currentPassword, password, confirmPassword }` → `{ accessToken, refreshToken }` (replace both); other devices signed out | 5.2 |

### Plans, subscription, payment (§6)

| Method | Path | CSP | BC | Sub | Body → answer | § |
|---|---|---|---|---|---|---|
| GET | `/subscriptions/plans?ownerType=CSP\|BC` | ✓ | ✓ | public | → plans `{ id, code, name, machineLimit, pricing[] (with `gstPercent`, `gstAmount`, `priceWithGst`), features[] }` | 6 |
| GET | `/subscriptions/current` | ✓ | ✓ | login | → current subscription or `null` | 6 |
| GET | `/subscriptions/history` | ✓ | ✓ | login | → all subscriptions | 6 |
| GET | `/subscriptions/access` (rev 26) | ✓ | ✓ (`gated: false`) | login | → state, `screens`, `blocked`, renewal / mandate, upgrade window, cancel | 7.1 |
| POST | `/subscriptions/quote` (rev 26) | ✓ | — | login | `{ planId, machineCount }` → `purpose` PURCHASE / UPGRADE, amount + GST, breakdown | 6A.2 |
| POST | `/subscriptions/current/cancel` (rev 26) | ✓ | — | running | `{ reason? }` → cancelled, usable until `endDate`, mandate cancelled | 6A.5 |
| POST | `/payments/create-order` + `Idempotency-Key` | ✓ (`machineCount` 1–100) | ✓ (no `machineCount`) | login | `{ planId, billingCycle, machineCount? }` → payment `PENDING` with `purpose` (PURCHASE / UPGRADE), `breakdown`, `mandate` | 6, 6A |
| POST | `/payments/verify` | ✓ | ✓ | login | `{ paymentId, gatewayTransactionId, transactionReference? }` → subscription created / extended | 6 |
| GET | `/payments/history` | *own* | *own* | login | → payments | 6 |
| GET | `/payments/:paymentId` | *own* | *own* | login | → one payment (poll while `PENDING`) | 6 |

### Activation codes (§8)

| Method | Path | CSP | BC | Sub | Body → answer | § |
|---|---|---|---|---|---|---|
| GET | `/activations` | *own* | *own* (none on ₹799) | active | → activations `{ id, activationCode, status, assignedAgentId, machine, pendingRevokeRequest, … }` | 8 |
| GET | `/activations/:activationId` | *own* | *own* | active | → one, with `canRegenerate` | 8 |
| POST | `/activations/assign` | to itself or its KOs | to its CSPs / KOs | active | `{ activationId, assignedAgentId }` → `{ activationCode, activationPassword }` (once) | 8 |
| POST | `/activations/:activationId/regenerate-password` | *own* | *own* | active | → new password (once; only `NOT_ACTIVATED`) | 8 |
| POST | `/activations/:activationId/revoke-requests` | *own* | *own* | active | `{ reason? }` → 201 request `PENDING` (super admin decides) | 8 |
| GET | `/activations/revoke-requests?status=&activationId=&page=&limit=` | *own* | *own* | active | → requests | 8 |
| GET | `/activations/revoke-requests/:requestId` | *own* | *own* | active | → one request | 8 |
| POST | `/activations/revoke-requests/:requestId/cancel` | *own* | *own* | active | → `CANCELLED` (pending only) | 8 |

### Agents: CSPs and KOs (§9)

| Method | Path | CSP | BC | Sub | Body → answer | § |
|---|---|---|---|---|---|---|
| GET | `/agents?type=CSP\|KO&parentAgentId=&page=&limit=` | itself + its KOs | its CSPs + KOs | login | → agents | 9 |
| GET | `/agents/:agentId` | in scope | in scope | login | → agent | 9 |
| POST | `/agents/ko` | ✓ | — | login (no running plan needed) | `{ agentId, name, mobile?, email?, address?, openingCash?, cashAdjustments? }` → 201 `{ ko, cash }` (rev 26: cash in hand from the CSP / edited agents; the rest raises the limit) | 9.1 |
| POST | `/agents/:agentId/replace` (rev 26) | its KOs | — | login | `{ agentId, name, mobile?, email?, address? }` → new KO takes the PC + cash | 9.2 |
| POST | `/agents/csp` | — | ✓ | **machines** | `{ agentId, name, …, openingCash, openingCashInAccount, kos?: [{ agentId, name, openingCash }] }` (limit = sum) → 201 created / 202 link request sent | 9 |
| PATCH | `/agents/:agentId` | itself + its KOs | itself + its CSPs / KOs (not ₹799-linked ones) | login | `{ name?, mobile?, email?, address?, cashLimit?, openingCash?, openingCashInAccount?, status? }` | 9 |
| DELETE | `/agents/:agentId` | its KOs | its CSPs (KOs first) / KOs | login | soft delete (never your own account); rev 26: the KO's cash leaves the pool | 9.3 |

### BC ₹799: link CSPs (§10)

| Method | Path | CSP | BC | Sub | Body → answer | § |
|---|---|---|---|---|---|---|
| GET | `/bc-links/csps/search?search=` | — | ✓ | **link** | → up to 20 subscribed CSPs `{ agentId, name, koCount, linkStatus, hasPendingRequest }` | 10 |
| POST | `/bc-links/requests` | — | ✓ | **link** | `{ cspAgentId, remarks? }` → 201 request `PENDING` | 10 |
| GET | `/bc-links/requests?status=&isConflict=&cspAgentId=&page=&limit=` | — | *own* | **link** | → requests | 10 |
| GET | `/bc-links/requests/:requestId` | — | *own* | **link** | → one request | 10 |
| POST | `/bc-links/requests/:requestId/cancel` | — | *own* | **link** | → `CANCELLED` (pending only) | 10 |

### Dashboard (§11)

| Method | Path | CSP | BC | Sub | Query → answer | § |
|---|---|---|---|---|---|---|
| GET | `/dashboard/summary` | ✓ | ✓ | active | `from, to, agentId, includeKos, machineId, receiptType, transactionCategory, search` → overview, services, cash, **commission (today + month, rev 25)**, status, activations, recent, subscription (+ CSP: `float`, `machine`; BC: `machineMonitoring`, `cspSummary`) | 11 |
| GET | `/dashboard/analytics` | ✓ | ✓ | active | same + `groupBy=hour\|day\|week\|month\|year` → trends | 11 |
| GET | `/dashboard/csp/:agentId/detail?section=transaction\|socialSecurity&month=YYYY-MM` | (itself) | its CSPs | active | → day-by-day table for the month | 11 |

### Machines (§12)

| Method | Path | CSP | BC | Sub | Body / query → answer | § |
|---|---|---|---|---|---|---|
| GET | `/machines/list` | its PCs + KOs' | all its CSPs' / KOs' | active | `page, limit, search, agentId, agentType, machineStatus, connectionStatus, watcherEnabled, sortBy, sortOrder, from, to` → items | 12 |
| GET | `/machines/:machineId` | in scope | in scope | active | → detail | 12 |
| GET | `/machines/:machineId/analytics` | in scope | in scope | active | → sessions, daily online hours | 12 |
| GET | `/machines/:machineId/activity-sessions` | in scope | in scope | active | → SBI login activity | 12 |
| GET | `/machines/:machineId/heartbeat` | in scope | in scope | active | → live status | 12 |
| PATCH | `/machines/:machineId` | in scope | in scope | active | `{ machineName?, watcherEnabled? }` | 12 |

### Transactions and reports (§13, §14, §17)

| Method | Path | CSP | BC | Sub | Query → answer | § |
|---|---|---|---|---|---|---|
| GET | `/receipts` | ✓ | ✓ | active | `page, limit, from, to, period, machineId, agentIds, receiptTypes, transactionCategories, status, search, sortBy, sortOrder` → items | 13 |
| GET | `/receipts/stats` | ✓ | ✓ | active | same filters → `{ total, success, failed, totalAmount, commissionAmount }` | 13 |
| GET | `/receipts/fields` | ✓ | ✓ | login | → `[{ field, label, personal, fixed, allowed }]`: optional fields and their display names | 13 |
| GET | `/receipts/:receiptId?agentId=` | in scope | in scope | active | → detail (+ `cashDenomination` with `CASH_MANAGEMENT`, `hasSlip`); send `agentId` (receipt numbers are unique per agent) | 13 |
| GET | `/receipts/:receiptId/slip?agentId=` | in scope | in scope | active | → `{ url, expiresIn: 300 }` link to the slip image (404 when `hasSlip` is false) | 13 |
| GET | `/receipts/:receiptId/pdf?agentId=` | in scope | in scope | active | → `application/pdf` (download / share) | 13, 17 |
| POST | `/receipts/:receiptId/report?agentId=` | ✓ | ✓ | active | `{ reason, details? }` → the problem report (201) | 13 |
| GET | `/receipts/reports?status=` | ✓ | ✓ | login | → your scope's problem reports (newest 100) | 13 |
| GET | `/receipts/export` | ✓ | ✓ | active | same filters → `.xlsx` | 13, 17 |
| GET | `/reports/summary` | ✓ | ✓ | active | `period, from, to, cspAgentId, agentId` → one row per CSP (with KOs) | 14 |
| GET | `/reports/export` | ✓ | ✓ | active | same → `.xlsx` | 14, 17 |

### Cash management (§13A)

BCs read a CSP's cash with `agentId` = the CSP (or one of its KOs); without it → 400. A CSP reads its own (optional `agentId` = one of its KOs).

**Rev 26:** `POST /cash-management/transactions` adds `type: "INCREASE" | "DECREASE"` (13A.10), ADJUSTMENT refuses `cashLimit`; new `GET /cash-management/adjustments` (13A.11). Every cash call needs `CSP_COMPLETE` for a CSP (403 `PLAN_UPGRADE_REQUIRED` / `SUBSCRIPTION_REQUIRED`).

**BC cash scope (rev 25):** a BC sees **only the cash limit and its distribution**: `GET /cash-management` (without `cashOther` / `cashDueExtra`) and the dashboard `cash` block (same fields left out). Every other cash endpoint (ledger, settlements, requests, labels, dues, day closes, tasks) answers **403** to a BC: hide those screens in the BC app. "Other cash" is only for the CSP and its KOs.

| Method | Path | CSP | BC | Sub | Body / query → answer | § |
|---|---|---|---|---|---|---|
| GET | `/cash-management?agentId=` | ✓ | *read* (no other cash) | cash | → pool: limit, cash in account, in bank, left in bank, other cash (CSP only), extra cash held by dues (CSP only), each agent's cash in hand + drawer, `pendingRequests`, `openSettlements` | 13A |
| POST | `/cash-management/transactions` + `Idempotency-Key` | ✓ | — | cash | `{ type: SETTLEMENT, agentId, amount, direction }` or `{ type: ADJUSTMENT, cashLimit?, cashInAccount?, cashLeftInBank?, cashOther?, agents?, remarks }` → pool | 13A |
| GET | `/cash-management/ledger` | ✓ | — | cash | `agentId, agentIds, types, period, from, to, page, limit` → audit entries | 13A |
| GET | `/cash-management/settlements` | ✓ | — | cash | `agentId, agentIds, status, period, from, to, page, limit` → the KOs' settlement steps | 13A |
| GET | `/cash-management/requests` | ✓ | — | cash | `status, agentId, page, limit` → KO correction requests | 13A |
| POST | `/cash-management/requests/:requestId/review` | ✓ | — | cash | `{ action: APPROVE\|REJECT, remarks? }` | 13A |
| GET | `/cash-management/labels` | ✓ | — | cash | → labels | 13A |
| POST | `/cash-management/labels` | ✓ | — | cash | `{ name, direction: IN\|OUT\|BOTH }` | 13A |
| PATCH | `/cash-management/labels/:labelId` | ✓ | — | cash | `{ name?, direction?, active? }` | 13A |
| GET | `/cash-management/dues` | ✓ | — | cash | `agentId, status=OPEN\|CLOSED` → dues + totals | 13A |
| GET | `/cash-management/dues/:dueId` | ✓ | — | cash | `agentId` → the due + `events` (history) | 13A |
| GET | `/cash-management/day-closes` | ✓ | — | cash | `agentId, from, to` → today's state per agent + closes | 13A |
| GET | `/cash-management/tasks` | ✓ | — | cash | `agentId, status=OPEN\|DONE\|ALL` → tasks | 13A |
| POST | `/cash-management/tasks` | ✓ | — | cash | `{ agentId, title, note?, dueAt? }` → task for a KO | 13A |
| PATCH | `/cash-management/tasks/:taskId` | its own tasks | — | cash | `{ title?, note?, dueAt?, done? }` | 13A |
| DELETE | `/cash-management/tasks/:taskId` | its own tasks | — | cash | → `Task deleted.` | 13A |

### Commission and team (§13B, §13C)

| Method | Path | CSP | BC | Sub | Query / body → answer | § |
|---|---|---|---|---|---|---|
| GET | `/commission/summary` | ✓ (its + its KOs') | its CSPs | active | `period=TODAY\|WEEK\|MONTH, month=YYYY-MM, agentId` → total, groups, rows per service, byAgent | 13B |
| GET | `/commission/months` | ✓ | its CSPs | active | `count, agentId` → monthly totals | 13B |
| GET | `/commission/rates` | ✓ | `agentId` required | active | → live rate per service | 13B |
| GET | `/team/today` | ✓ | its CSPs | active | `date, agentId` → per agent: online, first login, online / active time, late, early | 13C |
| GET / PATCH | `/team/settings` | ✓ | — | login | `{ workdayStart, workdayEnd }` | 13C |

### Metrics, CSP visits, uploads (§15, §16)

| Method | Path | CSP | BC | Sub | Body → answer | § |
|---|---|---|---|---|---|---|
| GET | `/metrics` | ✓ | ✓ | login | → metric definitions | 15 |
| GET | `/metrics/:metricId` | ✓ | ✓ | login | → one definition | 15 |
| GET | `/metrics/values?agentId=&metricId=&from=&to=` | in scope | in scope | login | → entered values | 15 |
| POST | `/metrics/values` | — | ✓ | login | `{ metricId, agentId (a CSP), date, value }` | 15 |
| PATCH | `/metrics/values/:valueId` | — | ✓ | login | `{ value }` | 15 |
| POST | `/uploads/presigned-url` | (not used) | ✓ | login | `{ fileName, contentType }` → `{ key, uploadUrl, fields }` (S3 POST, 5 min, ≤ 5 MB) | 16 |
| GET | `/uploads/presigned-url?key=` | (not used) | ✓ (own keys) | login | → signed download URL | 16 |
| DELETE | `/uploads` | (not used) | ✓ (own keys) | login | `{ key }` (a discarded photo) | 16 |
| POST | `/csp-visits` | — | ✓ | login | `{ cspAgentId, visitDate, photoUrl: key, latitude?, longitude?, remarks?, customerReviews: [≥ 5] }` (one per CSP per month) | 16 |
| GET | `/csp-visits/csp/:cspAgentId?from=&to=` | (itself) | its CSPs | login | → visits | 16 |
| GET | `/csp-visits/:id` | in scope | in scope | login | → visit with a 5-minute photo URL | 16 |

### What each tab calls, in order

| Role | Tab / screen | Calls (first load → actions) |
|---|---|---|
| both | launch | `GET /subscriptions/current` → `GET /subscriptions/plans?ownerType=` (features) |
| both | Plans / Paywall | `GET /subscriptions/plans` → `POST /payments/create-order` → `POST /payments/verify` → `GET /subscriptions/current` |
| both | More → Subscription | `GET /subscriptions/current`, `GET /subscriptions/history`, `GET /payments/history`, `GET /payments/:id` |
| both | Home | `GET /dashboard/summary` (+ every 60 s) → `GET /dashboard/analytics?groupBy=` |
| BC | Home → CSP | `GET /dashboard/summary?agentId=` → `GET /dashboard/csp/:agentId/detail` |
| both | Machines | `GET /machines/list` → `GET /machines/:id` (+ `/analytics`, `/activity-sessions`, `/heartbeat`) → `PATCH /machines/:id` |
| both | Transactions | `GET /receipts` + `GET /receipts/stats` → `GET /receipts/:receiptId` → `GET /receipts/export` |
| both | Reports | `GET /reports/summary` → `GET /reports/export` |
| CSP | More → KOs | `GET /agents?type=KO` → `POST /agents/ko` → `PATCH` / `DELETE /agents/:agentId` |
| BC (₹199 / ₹399) | CSPs | `GET /agents?type=CSP` → `POST /agents/csp` → `GET /agents?type=KO&parentAgentId=` → `PATCH` / `DELETE /agents/:agentId` |
| BC (₹799) | CSPs → Link CSP | `GET /bc-links/csps/search` → `POST /bc-links/requests` → `GET /bc-links/requests` → `POST …/cancel` |
| CSP, BC (₹199 / ₹399) | Activation codes | `GET /activations` → `POST /activations/assign` → `POST …/regenerate-password` → `POST …/revoke-requests` → `GET /activations/revoke-requests` |
| CSP (cash plans) | Cash | `GET /cash-management` → settle / adjust `POST /transactions` → `GET /requests` + review → `GET /settlements` → `GET /ledger` → `GET /dues` → `GET /day-closes` → `GET|POST|PATCH|DELETE /tasks` → `GET|POST|PATCH /labels` |
| BC | CSP → Cash | the same GETs with `agentId` = the CSP |
| BC | More → Metrics | `GET /metrics` → `GET /metrics/values` → `POST` / `PATCH /metrics/values` |
| BC | More → CSP visits | `POST /uploads/presigned-url` → S3 POST → `POST /csp-visits` → `GET /csp-visits/csp/:cspAgentId` → `GET /csp-visits/:id` |

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
| ~~`cspLimit`~~ | **Rev 26: remove the field.** The CSP limit is **worked out**: cash in hand + cash in account. Older apps may still send it; it's ignored (no "must equal" check any more). Show the sum read-only under the two fields ("Your cash limit: ₹1,00,000"). |

At first the CSP holds **all** the cash in hand (e.g. cash in hand ₹1,00,000, cash in account ₹0 → limit ₹1,00,000). It hands cash in hand to each KO when it adds one (§9.1).

The cash fields are ignored for `BC`. Send numbers (a numeric string like `"2500.50"` also works). An empty field counts as missing, never as 0. Other messages: `… can't be negative.`, `… must be a number.`, `… can have at most 2 decimal places.`, `… is too large.` (max 9,999,999,999.99).

What the server does with them (CSP): stores them on the agent (`openingCash`, `openingCashInAccount`, `cashLimit` = their sum) and opens the CSP's **cash pool** (§13A): the limit and cash in account shared with its KOs, and the CSP's own cash in hand, with an `OPENING` entry in the cash ledger.

→ 201 `Signup successful. OTP sent for verification.` `data: { userId, openingFloat }`. `openingFloat` (CSP only):
- `CREATED`: the float was opened with these values.
- `UPDATED`: signup was sent again (resend OTP) before anything was recorded, so the new values replaced the old ones.
- `KEPT`: the agent already exists and its pool is in use (KOs added, receipts, settlements or adjustments recorded), so balances, opening values and limit stay as they are. Changes go through cash management (§13A).
Errors: 409 `Account already exists. Please login.`; 403 `KO cannot create login account.`

**`POST /auth/verify-otp`** (public) `{ agentId, otp }` — `otp` exactly 6 digits. OTP is valid **10 minutes**, **5 attempts** (rev 25: wrong codes now really count; the 5th wrong one deletes the OTP → "request a new OTP").
→ 200 `OTP verified successfully.` Then go to Login (no token is returned here).
Errors (409 unless noted): `Invalid OTP.`, `OTP has expired. Please request a new OTP.`, `Maximum OTP attempts exceeded. Please request a new OTP.`, 404 `OTP not found. Please request a new OTP.`, 404 `User not found.` For "request a new OTP", call signup again with the same data.

**`POST /auth/login`** (public) `{ agentId, password }`

```json
"data": {
  "accessToken": "…", "refreshToken": "…",
  "user": { "id": "…", "agentId": "CSP-001", "email": "…", "role": "CSP_ADMIN" }
}
```

Login errors (all **403**, show `message`): `Invalid credentials.` (unknown ID **or** wrong password; the server doesn't say which), then, only after a correct password: `Please verify your account first.` (→ OTP screen), `Your account has been blocked.`, `Your account has been suspended.` (rev 25: followed by ` Reason: <the super admin's reason>` when one was given — show the whole message). Not 401, so the session-expired interceptor (§3) doesn't fire on the login screen.

Errors: 404 `User not found.`; 403 `Please verify your account first.` (→ OTP screen), `Your account has been blocked.`, `Your account has been suspended.`, `Invalid credentials.`

### 5.2 Refresh, logout, resend OTP (rev 23), forgot / reset / change password (rev 25)

**`POST /auth/refresh`** (public) `{ refreshToken }` → 200 `Session refreshed.` `data: { accessToken, refreshToken, user }`.
- Every refresh returns a **new** refresh token: store it and drop the old one. The old one stops working.
- Sending an old (already used) refresh token again is treated as a stolen token: that session is ended and every token of it fails (401 `REFRESH_TOKEN_INVALID`) → Login.
- 401 `REFRESH_TOKEN_INVALID` (`Invalid refresh token.` / `Refresh token has expired.`) → Login. A blocked or suspended account → 403 `ACCOUNT_BLOCKED` / `ACCOUNT_SUSPENDED` and the session ends.
- A refresh token lasts **7 days** from its last use (each refresh restarts the 7 days). One session per login, so each phone has its own.
- Not under the strict `/auth` rate limit (20 / 15 min); the general limit applies.

**`POST /auth/logout`** (public) `{ refreshToken }` → 200 `Logged out.` Ends that session (any token, even an old or invalid one, answers 200). Call it on Logout, then delete the tokens.

**`POST /auth/resend-otp`** (public) `{ agentId }` → 200 `OTP sent again.` `data: { expiresAt, resendAvailableAt }`: a new code to the same email (the old one stops working). Errors: 409 `OTP_RESEND_TOO_SOON` `Please wait N seconds before asking for a new OTP.` (one per minute: use `resendAvailableAt` for the countdown), 409 `OTP_RESEND_LIMIT` `Too many OTPs sent. Please try again in an hour.` (5 per hour), 409 `ACCOUNT_EXISTS` (already verified → Login), 404 `User not found.` Use it for "Send a new code"; signup again is no longer needed.

**Forgot password (rev 25).** Login screen → "Forgot password?" → enter agent ID → OTP + new password screen → Login.

**`POST /auth/forgot-password`** (public) `{ agentId }` → **always** 200 `If this agent ID has an account, an OTP has been sent to its registered email.` `data: { resendAvailableAt }`. The answer is the same for an unknown ID, a pending / blocked account, and when a send is skipped by the limits (one per minute, 5 per hour), so it never reveals whether an ID exists. Show the message as is, then the OTP screen with a "Send again" button enabled at `resendAvailableAt` (60 s). The OTP is valid 10 minutes, 5 attempts.

**`POST /auth/reset-password`** (public) `{ agentId, otp, password, confirmPassword }` (password 8–100 chars, must match) → 200 `Password reset. Please log in with your new password.` **Every session of the user ends** (all phones: their refresh tokens fail; their access tokens get 401 `SESSION_ENDED` at once). Go to Login with the agent ID prefilled. Errors: 409 `OTP_INVALID` (`Invalid OTP.`), 409 `OTP_EXPIRED`, 409 `OTP_ATTEMPTS_EXCEEDED`, 404 `OTP_NOT_FOUND` (also for an unknown ID — ask for a new OTP), 400 validation (`Passwords do not match.`).

**`POST /auth/change-password`** (logged in; Profile → Change password) `{ currentPassword, password, confirmPassword }` → 200 `Password changed. Other devices have been signed out.` `data: { accessToken, refreshToken }`: **replace both tokens** with these (the old ones stop working at once). Errors: 400 `CURRENT_PASSWORD_INCORRECT`, 400 `PASSWORD_UNCHANGED` (`New password must be different from the current one.`), 400 validation. Under the `/auth` rate limit (20 / 15 min).

**Blocked while logged in (rev 25).** The super admin can block or suspend an account; access stops **at once**: the next API call with a still-valid access token gets **403 `ACCOUNT_BLOCKED` / `ACCOUNT_SUSPENDED`** (message includes ` Reason: …`), and refresh fails too. On either code: clear tokens and show a full-screen "Your account has been blocked / suspended" with the message (no retry loop, no refresh). **401 `SESSION_ENDED`** (`Session ended. Please log in again.`) means the password was changed or reset elsewhere: don't refresh, go to Login.

Still planned (not built; proposals):

| Endpoint (proposed) | Body | Purpose |
|---|---|---|
| `POST /notifications/devices` / `DELETE /notifications/devices/:token` | `{ token, platform: "ios" \| "android" }` | register/unregister the push token (Expo or FCM, provider TBD) |
| (no endpoint) activation email | — | assign/regenerate will email the code + password to the agent |

Email is still a console stub on the server: OTPs (signup and reset) are not delivered yet in any environment except through the server log.

The 401 interceptor (§5.3) calls `/auth/refresh` once, retries the request, and logs out only if the refresh fails.

### 5.3 Session

- Store `accessToken` and `user` in secure storage. **Don't store the password.**
- The access token lasts **15 minutes**. Store `refreshToken` in secure storage too. On 401 `SESSION_ENDED` → Login (no refresh). On 403 `ACCOUNT_BLOCKED` / `ACCOUNT_SUSPENDED` from **any** endpoint → blocked screen (above). On 401 (`TOKEN_EXPIRED` / `TOKEN_INVALID`): call `POST /auth/refresh` **once** (one refresh at a time: queue the other requests until it answers), save both new tokens, retry the request. If the refresh fails (401 `REFRESH_TOKEN_INVALID` or 403) → Login prefilled with the `agentId`. You can also refresh shortly before `exp`.
- Logout = `POST /auth/logout { refreshToken }`, then delete tokens + `queryClient.clear()`.
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

Plan: `{ id, code, name, ownerType, level, machineLimit, pricing: [{ billingCycle, durationDays, price, gstPercent, gstAmount, priceWithGst }], features: [{ code, name, description, category }] }` (`price`, `gstAmount`, `priceWithGst` are **strings**; for CSP plans they're per machine).

**GST (rev 25): price + GST, subscriptions only.** The plan price is before tax; GST (rate set by the super admin, **18 %** today, `gstPercent`) is added at checkout. Show "₹550 + 18% GST = ₹649" on the plan card and the checkout total = `priceWithGst × machines` (the server computes the same: `create-order` returns `amount` = price × machines, `taxPercent`, `taxAmount`, `totalAmount` = amount + tax — **charge `totalAmount`**). A paid payment gets an `invoiceNumber` (`INV…`) in the payment detail / history: show it on the payment receipt. Nothing else in the app (receipts, cash, commission) has GST.
Current subscription: `{ id, subscriptionNumber, status, subscriptionType, machineLimit, amountPaid (string), startDate, endDate, graceEndsAt, plan: { id, code, name, ownerType, level, features: [{ code, name, description, category }] }, latestPayment: { paymentNumber, status, amount, totalAmount, paidAt } }`.
`create-order` returns the payment: `{ id, paymentNumber, amount, taxPercent, taxAmount, totalAmount, currency: "INR", status: "PENDING", planId, billingCycle, invoiceNumber (null until paid), … }` (money fields are strings).

**CSP checkout (per machine):**

```
[Plan + cycle] → [Machines: − 2 +]  → total = price × machines (show it; the server computes the same)
   → POST /payments/create-order { planId, billingCycle, machineCount: 2 }   → amount "500", taxAmount "90", totalAmount "590", machineCount 2
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

**Purchase rules (server).** **Rev 26: CSP rules changed, see §6A** (upgrade only, difference only, first 12 days; renewals by UPI mandate; cancel). What follows is for **BC** plans only (unchanged):
- Same plan **and same machine count** while it's running → **renewal**: the end date is extended from the current end date; machines keep working.
- Different plan → **switch**: a new subscription starts now and the old one ends immediately. Machines already activated move to the new plan (up to its machine limit). No refund/credit for unused days.
- **Grace period (rev 25; BC plans only since rev 27):** CSP subscriptions always have `graceEndsAt: null` — they renew by mandate on the end date and are blocked while the charge is tried (§6A.4). For BC plans: the super admin sets a grace period (0 days today, up to 30). During grace (after `endDate`, until `graceEndsAt`) everything keeps working, in the app and on the PCs; a renewal in grace continues from the old `endDate` (no days lost). `graceEndsAt` is `null` when there's no grace. Show "Expired on `endDate` — renew before `graceEndsAt` to keep using CSP Manager" as a banner while `endDate < now ≤ graceEndsAt`. When the super admin changes the grace period, running subscriptions follow it.
- After the plan (and its grace) ended → new subscription from now.
- Buying a plan of the wrong owner type → 400 `This plan is not available for your account.`; unknown cycle → 400 `Selected billing cycle is not available.`

**Payment status — PENDING backend work:** today the payment is "manual": the app calls `create-order` and then `verify` with any `gatewayTransactionId`. Razorpay is being integrated (pre-production checklist 1.1–1.5). Build the checkout behind one function `payForPlan(planId, billingCycle)` so swapping in `react-native-razorpay` later only changes that function. Don't ship the manual flow to production users.

**UI notes:** plan cards list every `pricing` entry (cycle selector) with "+ GST"; CSP plans show "per machine" and a machine stepper (default and minimum while a plan runs: current `machineLimit`, §6A). Show "Renews on `endDate` by UPI autopay". Switching a BC machine plan to `BC_CSP_LINK` (0 machines) must warn: "Your machines will stop working."

## 6A. Subscription rules (rev 26): upgrade, cancel, UPI mandate, auto renewal

These apply to **CSP** subscriptions (BC plans keep §6). Read the state from **`GET /subscriptions/access`** (§7.1): `subscription`, `renewal`, `upgrade`, `cancel`.

### 6A.1 What the CSP can do, by state

| `state` | Meaning | Allowed | Not allowed |
|---|---|---|---|
| `NONE` | never subscribed | buy any plan, any machines | — |
| `ACTIVE` | running; renews by mandate on `endDate` | **upgrade** (first 12 days only), **cancel** | same plan + same machines again (409 `SUBSCRIPTION_ALREADY_ACTIVE`), lower plan (400 `PLAN_DOWNGRADE_NOT_ALLOWED`), fewer machines (400 `MACHINE_DECREASE_NOT_ALLOWED`), upgrade after day 12 (400 `UPGRADE_WINDOW_CLOSED`) |
| `RENEWAL_PENDING` | `endDate` passed, the mandate charge is being tried / retried (up to ~30 min). **Blocked** (rev 27) until a charge succeeds | wait; cancel | upgrade, purchase (409 `RENEWAL_IN_PROGRESS`) |
| `CANCELLED` | cancelled, still works until `cancel.usableUntil` (= `endDate`), won't renew | **buy a new subscription** (any plan / machines; see 6A.5) | upgrade |
| `LAPSED` | renewal failed 3 times (or no mandate) → stopped at once | buy / renew (new purchase) | everything in the blocked list (§7) |
| `EXPIRED` | ended (cancelled and past `endDate`, or no mandate) | buy / renew (new purchase) | blocked list (§7) |

"Renew" in the app for `LAPSED` / `EXPIRED` = a new purchase (`create-order` with the plan and machines the CSP picks; pre-select the last ones from `subscription`). It creates a new mandate.

### 6A.2 Upgrade: difference only, end date unchanged, first 12 days

An upgrade changes the **running** subscription in place: higher plan and/or more machines. **The start and end dates and the activations don't change**; extra machines get new activation codes (unassigned, §8).

```
amount (before GST) = (new price − old price) × current machines   ← plan difference (0 if same plan)
                    + new price × added machines                    ← new machines
total               = amount + GST (gstPercent, 18 % today)
```

| From → to | Calculation | Amount | + 18 % GST |
|---|---|---|---|
| 1 × ₹250 (automation) → 1 × ₹550 (complete) | (550 − 250) × 1 | ₹300 | ₹354 |
| 1 × ₹550 → 2 × ₹550 (add 1 machine) | 0 + 550 × 1 | ₹550 | ₹649 |
| 1 × ₹250 → 2 × ₹550 | (550 − 250) × 1 + 550 × 1 | ₹850 | ₹1,003 |
| 1 × ₹250 → 2 × ₹250 | 0 + 250 × 1 | ₹250 | ₹295 |
| 2 × ₹550 → 1 × ₹550 | — | 400 `MACHINE_DECREASE_NOT_ALLOWED` | |
| 1 × ₹550 → 1 × ₹250 | — | 400 `PLAN_DOWNGRADE_NOT_ALLOWED` | |

"Old price" is the price per machine the subscription was bought / last upgraded at (`subscription.pricePerMachine`; falls back to the plan's current price for older subscriptions). Upgrades are monthly only (`billingCycle: MONTHLY`; else 400 `Upgrades are billed on the monthly plan.`).

**Window:** allowed while `now ≤ upgrade.windowEndsAt` = **12 days after the purchase or the last renewal** (`subscription.currentPeriodStart` + 12 days; each mandate renewal starts a new period and a new window). After it: 400 `UPGRADE_WINDOW_CLOSED` "Upgrades are allowed only in the first 12 days of the plan or its last renewal (until …)." Show "Upgrade available until <date>" or, when closed, "Upgrades open again after your next renewal on <endDate>".

**Calls:**

1. **Quote** (no side effects): `POST /subscriptions/quote` `{ planId, machineCount }` (CSP) →
   ```json
   "data": { "purpose": "UPGRADE", "planId": "…", "planCode": "CSP_COMPLETE", "machineCount": 2,
             "previousPlanId": "…", "previousMachineCount": 1,
             "amount": "850.00", "gstPercent": 18, "taxAmount": "153.00", "totalAmount": "1003.00",
             "breakdown": { "planDifference": { "machines": 1, "perMachine": "300.00", "amount": "300.00" },
                            "newMachines":    { "machines": 1, "perMachine": "550.00", "amount": "550.00" } } }
   ```
   `purpose: "PURCHASE"` (and `breakdown: null`) when there's no running subscription or it's cancelled. The same errors as `create-order` (409 / 400 above). Call it whenever the plan or machine stepper changes (debounce 300 ms) and show the breakdown lines.
2. **Order**: `POST /payments/create-order` `{ planId, billingCycle: "MONTHLY", machineCount }` (+ `Idempotency-Key`) → the payment with **`purpose: "UPGRADE"`**, `previousPlanId`, `previousMachineCount`, `subscriptionId` (the running one), `amount` / `taxAmount` / `totalAmount` as quoted, `breakdown`. Message `Upgrade order created: you pay only the difference. The plan's end date doesn't change.`
3. **Verify**: `POST /payments/verify` as before → 200 `Upgrade paid. New machine slots are ready to assign.` `data: { paymentId, subscriptionId }` (same id as before). Refresh `GET /subscriptions/access` and `GET /activations`.

An upgrade also raises the **mandate's monthly amount** (new price × machines + GST) from the next renewal; with a real gateway the CSP may have to approve the new amount in the UPI app (`renewal.mandate.amountChangePending: true` → show "Approve the new autopay amount in your UPI app"). A pending order priced before the situation changed (e.g. a purchase, now an upgrade) is cancelled and a new one is opened automatically.

**Plan price changed by the super admin (rev 27).** Every running CSP subscription on that plan (auto renew on, not cancelled, not lapsed) moves to the new price **from its next renewal**; the current period isn't charged again. Its mandate is **cancelled** (`status: "REPLACED"`) and a **new mandate** for the new monthly amount (new price × machines + GST) is created, starting at `endDate`. The CSP gets a notification `kind: "MANDATE_REPLACED"`:
- `data`: `{ subscriptionId, mandateId, previousMandateId, previousAmount, amount, status, authUrl, nextChargeAt }`.
- `status: "ACTIVE"` → info only: "…a new one for ₹X/month (incl. GST) is set up. It's charged from your next renewal on <date>."
- `status: "PENDING"` (real gateway) → the CSP must **approve the new mandate in the UPI app before `nextChargeAt`**, or the renewal can't be charged and the plan stops at its end date. Show a banner on the Subscription screen with **[Approve autopay]** → `renewal.mandate.authUrl` while `renewal.mandate.status === "PENDING"`.
- `subscription.pricePerMachine` in `/subscriptions/access` shows the new price; later upgrade differences are worked out from it.

**UI:** on the Plans screen while a plan runs, mark the current plan "Current", disable lower-level plans ("Can't downgrade: cancel and subscribe again"), set the machine stepper's minimum to `upgrade.minMachineCount`, hide everything when `upgrade.allowed` is false and show `upgrade.reason` (`UPGRADE_WINDOW_CLOSED`, `CANCELLED`, `NO_RUNNING_SUBSCRIPTION`).

### 6A.3 UPI mandate (autopay)

Every CSP **purchase** sets up a **recurring UPI mandate**: it charges the **current monthly amount** (price per machine × machines + GST) **every month on the day and time the plan ends**, for up to **25 years**, until the subscription is cancelled. `create-order` for a purchase returns `mandate: { required: true, frequency: "MONTHLY", years: 25 }`.

Mandate object (in `GET /subscriptions/access` → `renewal.mandate`):

```json
{ "id": "…", "status": "ACTIVE", "provider": "MANUAL", "amount": "649.00", "amountChangePending": false, "authUrl": null, "endAt": "2051-11-05T…" }
```

| `status` | Show |
|---|---|
| `PENDING` | "Approve the autopay in your UPI app" (+ open `authUrl` when present) |
| `ACTIVE` | "Autopay on: ₹`amount` on `renewal.nextChargeAt`" |
| `CANCELLED` | "Autopay cancelled (subscription cancelled)" |
| `REVOKED` | "Autopay removed in your UPI app. Your plan stops on `endDate`. Subscribe again to set up a new autopay." |
| `COMPLETED` | "Autopay ended" |

**PENDING backend work:** Razorpay UPI autopay isn't integrated yet (pre-production checklist 1.10). In development the mandate is created **ACTIVE at once** (`provider: "MANUAL"`) and charges succeed unless the server sets `DEV_MANDATE_RESULT=FAILED`. When Razorpay lands, the checkout will open the Razorpay mandate flow (UPI app approval) instead of the plain payment; keep the checkout behind `payForPlan()` (§6).

### 6A.4 Auto renewal, retries and stopping

```
endDate (day + time of purchase)  → charge 1
   success → endDate + 30 days, new 12-day upgrade window, notification "Subscription renewed"
   failed  → +15 min charge 2 → failed → +15 min charge 3 → failed → STOP at once (state LAPSED)
                                  (each failure: notification "Renewal payment failed", retry time)
```

- **While the charge is being tried (`state: RENEWAL_PENDING`, from `endDate` until a charge succeeds; ~30 min at most) the plan is blocked (rev 27, owner decision):** `usable: false`, `blocked: true`, all `screens` false, `desktop.automation` / `desktop.cashManagement` false, `blockReason: "RENEWAL_PENDING"`, `message` "Your plan's renewal payment is being charged through your UPI mandate. Services resume as soon as it goes through." The PCs are blocked too. A successful charge (attempt 1, 2 or 3) opens everything again at once (refetch `/subscriptions/access` on the `SUBSCRIPTION_RENEWED` notification or every 60 s while `RENEWAL_PENDING`).
- **Cancel while `RENEWAL_PENDING`** is allowed (`cancel.allowed: true`): it stops the retries and the plan **ends now** (`state: EXPIRED`), then a new purchase is possible. While a charge is waiting for the bank's answer it's refused with 409 `RENEWAL_IN_PROGRESS` ("…Try again in a few minutes.").
- A charge the bank hasn't answered in 30 min counts as a failed attempt. A renewal still unresolved 6 h after `endDate` is stopped (`LAPSED`, safety net).
- A late bank success for an old plan after a new plan was bought, or for an attempt whose period another attempt already renewed, doesn't extend anything: the payment shows `SUCCESS` with `failureReason` "…refund due." and the CSP gets a "Late renewal charge" notification.
- Buying a new plan while `RENEWAL_PENDING` → 409 `RENEWAL_IN_PROGRESS` ("…Please wait until it completes or fails (within about 30 minutes)."). After a lapse, a new purchase is allowed.
- Retries happen only if the payment method allows it; a removed mandate (`REVOKED`) or none at all → the plan stops at `endDate` with no retry.
- **On stop** (`LAPSED`): the server blocks the app's data screens and the desktop PCs **at once** (no grace period). `renewal.lastFailure` has the reason ("Insufficient balance", …). The CSP must **renew / subscribe again** (new purchase + new mandate).
- `renewal`: `{ autoRenew, nextChargeAt, attempts (0–3), maxAttempts: 3, lastFailure, lapsedAt, mandate }`.
- Payment history (`GET /payments/history`) shows each charge as a payment with **`purpose: "RENEWAL"`**, `attemptNumber` 1–3, `status` `SUCCESS` / `FAILED` (`failureReason`). Purchases are `PURCHASE`, upgrades `UPGRADE`.
- Subscription history adds events `RENEWAL` (each successful charge), `RENEWAL_FAILED` (each failed attempt, `remarks` "Attempt 2 of 3: …"), `LAPSED`, `UPGRADE`, `CANCELLATION`.

### 6A.5 Cancel

`POST /subscriptions/current/cancel` `{ reason? }` (CSP; ≤ 500 chars) →
```json
200 "Subscription cancelled. No refund is made; you can use it until <endDate>. The UPI mandate is cancelled."
"data": { "subscriptionId": "…", "cancelledAt": "…", "usableUntil": "<endDate>" }
```
- **No refund.** The plan keeps working until `endDate` (no grace after it), then stops (`EXPIRED`); it never renews. The mandate is cancelled with the gateway at once.
- Errors: 400 `You have no running subscription to cancel.`; 409 `SUBSCRIPTION_ALREADY_CANCELLED`.
- Confirm sheet: "Cancel your plan? No refund. You can use it until <endDate>. Autopay will be cancelled." [Keep plan] [Cancel plan].
- **Fewer machines / lower plan:** cancel, then **buy a new subscription** with the new plan / machine count. Buying while the cancelled one still runs starts the new one **now** (confirmed by the owner, rev 27): the cancelled one ends at once (its remaining days are not refunded) and its activated PCs move to the new subscription (up to the new machine count; extra codes are generated, codes beyond the count are revoked). Say so before payment: "Your cancelled plan ends now; remaining days aren't refunded."
- After cancelling, `cancel.allowed` is false and `cancel.usableUntil` is set: show "Cancelled — works until <date>" and a **Subscribe** button.

### 6A.6 Subscription screen (suggested)

```
Plan: CSP Complete Solution · 2 machines · ₹550 / machine / month
Period: 05 Nov – 05 Dec 2026   (Upgrade window open until 17 Nov)
Autopay: ON · next charge ₹1,298 on 05 Dec 2026, 14:18
[Upgrade plan / add machines]   [Cancel subscription]
Payments ›   Plan history ›
```
Refresh on screen focus and after every payment / cancel.

## 7. Paywall, plan blocking and feature gating

### 7.1 `GET /subscriptions/access` — what the plan opens (rev 26, call this first)

Call it **after login, on every app launch / resume, after any payment, upgrade or cancel, and when any call answers 403 `SUBSCRIPTION_REQUIRED` / `PLAN_UPGRADE_REQUIRED`**. Cache it in memory; poll every 5 min while the app is in the foreground (a renewal can fail and stop the plan while the app is open).

```json
"data": {
  "gated": true,                       // false for BC / super admin: nothing is blocked by this
  "state": "ACTIVE",                   // NONE | ACTIVE | CANCELLED | RENEWAL_PENDING | LAPSED | EXPIRED (§6A.1)
  "usable": true,                      // a running subscription
  "blocked": false,                    // true = show the non-closable popup (7.2)
  "blockReason": null,                 // SUBSCRIPTION_REQUIRED | PLAN_UPGRADE_REQUIRED | null
  "message": null,                     // "Please renew or take a new plan." | "Please upgrade the plan to use this."
  "screens": { "dashboard": true, "machines": true, "cash": true, "reports": true },
  "alwaysOpen": ["koManagement", "payments", "planHistory", "subscribe", "renew", "cancel", "notifications", "profile"],
  "desktop": { "automation": true, "cashManagement": true },
  "subscription": { "id", "subscriptionNumber", "status", "planId", "planCode", "planName", "planLevel", "machineLimit",
                    "pricePerMachine", "startDate", "currentPeriodStart", "endDate", "graceEndsAt", "features": [] },
  "renewal": { "autoRenew", "nextChargeAt", "attempts", "maxAttempts", "lastFailure", "lapsedAt", "mandate": { … } },
  "upgrade": { "allowed", "windowDays": 12, "windowEndsAt", "minPlanLevel", "minMachineCount", "reason" },
  "cancel":  { "allowed", "cancelledAt", "usableUntil" }
}
```

### 7.2 Where and when to block (CSP)

| When | Tabs / screens | What to show |
|---|---|---|
| `blocked: true` (`state` NONE / LAPSED / EXPIRED) | **Home (dashboard) and everything under it** (Team today, commission, recent transactions), **Machines tab** and its screens, **Cash tab** and its screens, **Reports tab** and its screens (transactions, exports) | A **non-closable popup** (no ✕, back button / swipe / tap outside don't close it) over the tab: **"Please renew or take a new plan."** with buttons **[Renew / Subscribe]** → Plans screen and **[Manage KOs]** → KO list. Hide tab content behind it (don't render stale data). |
| `blocked: true` | KO list / create / edit / delete / replace, Payments, Plan history, Plans / checkout, Subscription screen, Notifications, Profile, Logout | Open normally (these are `alwaysOpen`). |
| `blockReason: "PLAN_UPGRADE_REQUIRED"` (₹250 automation plan) | each tab whose `screens[x]` is `false`: dashboard, machines, cash, reports | Same non-closable popup with **"Please upgrade the plan."** and **[Upgrade]** → Plans (pre-selects `CSP_COMPLETE`) + **[Manage KOs]**. KO management, payments, plan history, subscription (upgrade / cancel) stay open. |
| `state: CANCELLED` | nothing blocked until `usableUntil` | Banner "Plan cancelled — works until <date>. [Subscribe]". |
| `state: RENEWAL_PENDING` (`blockReason: "RENEWAL_PENDING"`, rev 27) | the same tabs as `blocked: true` (dashboard, machines, cash, reports); KO management, payments, plan history, subscription, notifications stay open | Non-closable popup with `message` ("Your plan's renewal payment is being charged through your UPI mandate. Services resume as soon as it goes through."), a line "Attempt n of 3 — next try at <renewal.nextChargeAt>" when `renewal.attempts > 0` (show `renewal.lastFailure`), **[Manage KOs]** and **[Cancel plan]** (stops the retries, ends the plan now; confirm first). No Subscribe button (a purchase is refused until it completes, fails or is cancelled). Poll `/subscriptions/access` every 60 s while shown; close it when `usable` turns true. |
| `renewal.mandate.status` `REVOKED` | nothing blocked until `endDate` | Banner "Autopay removed — your plan stops on <endDate>. [Subscribe again]". |

**The server enforces the same**, so a stale app can't read blocked data: CSP calls to `/dashboard/*`, `/team/*`, `/machines/*` (app routes), `/receipts/*` (app routes), `/reports/*`, `/commission/*`, `/cash-management/*` answer **403** with
- `code: "RENEWAL_PENDING"`, message `Your plan's renewal payment is being charged…` — end date passed, the mandate charge is being tried (rev 27);
- `code: "SUBSCRIPTION_REQUIRED"`, message `Please renew or take a new plan.` — no running subscription;
- `code: "PLAN_UPGRADE_REQUIRED"`, message `Please upgrade the plan to use this.` — the plan doesn't include it.

Global axios interceptor: on any of these codes → refetch `/subscriptions/access` and show the popup on the current tab; never retry. `/agents/*`, `/payments/*`, `/subscriptions/*`, `/notifications/*`, `/auth/*` are never blocked for the CSP (KO create / edit / delete work without a running plan). `/activations` list works; assigning needs a running plan (403 subscription messages below).

**BC users:** `gated: false`, all `screens` true — BC rules are unchanged (below).

### 7.3 Older subscription messages (still sent by some calls)

Some calls (activation assign, BC calls) still answer 403 with one of:

```
No subscription found. Please purchase or activate a subscription to continue.
Your subscription has expired.
Your subscription has been suspended.
Your subscription has been cancelled.
Your subscription is pending activation.
Your subscription has not started yet.
```

→ open the Paywall/Plans screen with that message. (Plans, current subscription, payments and login stay accessible.)

**Features**: `GET /subscriptions/current` → `plan.features[].code` (rev 23; no second call needed, and it works for a plan deactivated after purchase). Build a `features: Set<string>` and gate UI:

| Feature | UI |
|---|---|
| `CASH_MANAGEMENT` | float / cash-in-hand / cash-in-account cards, denomination detail. **CSPs without it:** the server returns these fields as `null` (dashboard `float`, machine list `float`, machine monitoring float fields, receipt `cashDenomination`). Render "Upgrade to see cash" instead of 0. BCs always get them. |
| `CSP_LINKING` | BC "Link CSP" and "Link requests" screens (§10) |
| `DESKTOP_AUTOMATION`, `RECEIPT_SYNC` | informational in the app (they gate the desktop) |
| `MOBILE_TRACKING` | reserved; nothing to build yet |

`403 Your subscription does not include this feature.` (`PLAN_FEATURE_MISSING`) → upgrade prompt. Branch the Paywall on the `SUBSCRIPTION_*` codes (§3) rather than on the messages above.

**Rev 26:** for CSPs `MOBILE_TRACKING` is no longer "reserved": it's what opens the app's dashboard / machines / cash / reports (only `CSP_COMPLETE` has it). Use `screens` from §7.1 rather than checking features yourself.

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

**One activation per agent (rev 26):** an agent that already **holds** an activation — assigned and not used yet, or running on a PC — can't be given another: 400 `AGENT_ALREADY_HAS_ACTIVATION` ("This agent already has a running activation (CODE on MC-…). Assign codes only to agents without one." / "…already has an activation assigned (CODE) that isn't used yet…"). The same agent also can't activate a second code on another PC. In the assign sheet, list only agents with no `NOT_ACTIVATED`-assigned or `ACTIVE` activation (from `GET /activations`), and disable the rest with "Already has a code". To move a PC to another agent: revoke request (below) or **Replace KO** (§9.2).

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

Agent: `{ id, agentId, name, type, status ("ACTIVE" | "INACTIVE"), mobile, email, address, bcId, parentAgentId, cashLimit (string\|null; the CSP limit), openingCash (string\|null; opening cash in hand), openingCashInAccount (string\|null; opening cash in account), linkedAt, createdAt, updatedAt }`.

- `GET /agents` and `GET /agents/:agentId` include **inactive** agents for their owner (so an inactive KO can be shown and reactivated with `PATCH { status: "ACTIVE" }`); dashboards, machines and reports still leave inactive agents out.
- For a **BC** (and the super admin), each CSP also has **`ownSubscription`**: `{ status ("ACTIVE" | "EXPIRED" | "SUSPENDED" | "CANCELLED" | …), endDate, planCode } | null` — the CSP's own latest CSP subscription, `null` when it never bought one. Show "Own plan active" / "No own plan yet" (4A.5). KOs and CSP logins don't get the field.

**`POST /agents/csp` (BC on a machine plan: `BC_BASIC` / `BC_PRO`)**. Needs an active subscription (403 subscription messages, §7). A BC on the ₹799 plan can't use it: 403 `PLAN_LINK_ONLY` (it links CSPs instead, §10). Body: `{ agentId, name, mobile?, email?, address?, cashLimit, openingCash, openingCashInAccount, machineCount, kos?: [{ agentId, name, mobile?, email?, address?, openingCash, machineCount }] }`.
- **New CSP:** `openingCash` (cash in hand) and `openingCashInAccount` (cash in account) are **required** (`Cash in hand is required.`, `Cash in account is required.`). **Rev 26:** `cashLimit` is ignored: the CSP limit = cash in hand + cash in account. They open the CSP's cash pool (§13A). For an **existing** CSP (link request, 202) they're ignored.
- **KOs listed with a new CSP:** `openingCash` (optional); taken from the new CSP's cash in hand, the rest raises the limit (as in §9.1).

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

**`POST /agents/ko` (CSP)** body: `{ agentId, name, mobile?, email?, address?, openingCash?, cashAdjustments?, machineCount }` → 201 `KO created successfully.` `data: { ko, cash }`. Works for every CSP (with or without a BC) and **without a running plan** (KO management is always open). Errors: `KO is already linked with this CSP.`, `KO is already linked with another CSP.`, `Provided Agent ID does not belong to a KO.` **Rev 26:** the cash part changed completely — see §9.1. Ask for the KO's **email** (optional on the server, but the KO needs it to log in to cash management on a shared PC, §9.4).

**Edit/delete rules:**
- A BC **can't edit or delete** CSPs linked through a ₹799 link request, or their KOs → 403 `This CSP is linked for viewing only. It manages its own account.` Hide edit/delete for those (`linkType` on the link request; or catch the 403).
- `You cannot delete your own account.`; `Delete child agents first.` (delete KOs before the CSP); `You are not allowed to update/delete this agent.`

### 9.1 KO creation form: cash in hand (rev 26)

Only on a plan with **cash management** (`CSP_COMPLETE`, or a CSP on a BC machine plan). On `CSP_AUTOMATION` hide the cash section: `openingCash` is ignored and no cash is tracked.

**What the CSP does:** enters how much cash in hand it gives the new KO. The form also lists **every existing agent's cash in hand** — the CSP itself and its other KOs (from `GET /cash-management` → `agents[]`, with `machineActive` to label who has a running PC) — and the CSP may edit any of them, e.g. take cash back from another KO to give it to the new one.

```
New KO ─ Cash in hand for this KO: [ 60,000 ]

Cash in hand now                         after
  You (CSP-001)       1,00,000   →   [ 40,000 ]   ← pre-filled: taken from you first
  KO-001 (PC on)         0        →   [      0 ]
──────────────────────────────────────────────
Cash limit  1,00,000  →  1,00,000      (no change)
[Create KO]
```

**Server rules** (`openingCash` = the new KO's cash in hand; required on a cash plan: `Cash in hand is required.`):

1. **No `cashAdjustments`** (simple form): the KO's cash in hand is taken from **the CSP's own cash in hand**, as far as it goes; whatever the CSP's cash in hand doesn't cover is **new cash** and **raises the cash limit**.
2. **With `cashAdjustments: [{ agentId, cashInHand }]`** (the CSP edited rows): those agents get exactly the new cash in hand given (the CSP's row too, if sent); nothing else is taken automatically. Send the final value of **every row the CSP changed**, including the CSP's own row if you pre-filled it. The new KO must not be in the list; each agent once; ≥ 0.
3. **No check against the limit, ever.** The cash limit moves by the net change: (new KO's cash in hand) + Σ(after − before of the adjusted rows). Cash in account doesn't change.
4. Every existing agent whose cash in hand changed gets a mandatory **Adjust** request on its desktop (§13A.11) to count the notes taken from / given to it. The new KO counts its notes at PC activation (§13A.12).

**Worked example** (from the product owner):

| Step | CSP hand | KO1 hand | KO2 hand | KO3 hand | Cash in account | Cash limit |
|---|---|---|---|---|---|---|
| Signup: hand 1,00,000, account 0 | 1,00,000 | | | | 0 | 1,00,000 |
| Add KO1 with 60,000 (no adjustments) | 40,000 | 60,000 | | | 0 | 1,00,000 |
| Add KO2 with 50,000 (CSP has only 40,000) | 0 | 60,000 | 50,000 | | 0 | **1,10,000** (+10,000 new cash) |
| Add KO3 with 30,000, `cashAdjustments: [{ KO1, 30,000 }]` (take 30,000 back from KO1) | 0 | 30,000 | 50,000 | 30,000 | 0 | 1,10,000 (no change) → KO1 gets an Adjust request "₹30,000 taken" |
| Add KO4 with 20,000, `cashAdjustments: [{ KO2, 40,000 }]` (only 10,000 taken back) | 0 | 30,000 | 40,000 | 30,000 + KO4 20,000 | 0 | **1,20,000** (+10,000) |

**Answer** `data.cash` (null when the plan has no cash management or the pool isn't set up):

```json
{ "status": "ADDED", "cashLimit": 110000, "cashLimitChange": 10000, "cashInAccount": 0,
  "agents": [ { "agentId": "CSP-001", "cashInHandBefore": 40000, "cashInHand": 0 },
              { "agentId": "KO-002", "cashInHandBefore": 0, "cashInHand": 50000 } ] }
```
`{ "status": "NOT_SET_UP" }` when the CSP has no pool yet. Show a toast "Cash limit is now ₹1,10,000 (+₹10,000)" when `cashLimitChange ≠ 0`. Errors: 400 `Each agent can appear only once.`, `Agent … isn't part of this CSP.`, `The new KO's cash in hand goes in cashInHand, not in adjustments.`, `Cash in hand can't be below ₹0.00.`

### 9.2 Replace a KO (rev 26)

`POST /agents/:agentId/replace` (CSP; `:agentId` = the KO leaving) body `{ agentId, name, mobile?, email?, address? }` (the new KO) → 201 `KO replaced. The machine and cash management moved to the new KO.`
```json
"data": { "ko": { …new KO… }, "replaced": "KO-001", "cash": { "cashInHand": 30000 }, "machines": 1 }
```
What moves to the new KO: its **activation and PC** (keeps working, no re-activation; the old KO's unused assigned code too), **cash in hand and drawer**, open **balance dues**, open **tasks**, open **settlements**, pending **Adjust requests**. The cash limit doesn't change. The old KO is deleted. Errors: 404 `KO not found.` (not your KO), 400 `The new KO needs a different Agent ID.`, `An agent with this Agent ID already exists.` UI: KO detail → "Replace KO" → new KO form (no cash fields) → confirm "The PC and cash of <old> move to <new>; <old> is deleted."

### 9.3 Delete a KO (rev 26)

`DELETE /agents/:agentId` now also removes the KO's **cash management**: its cash in hand and drawer leave the pool and the **cash limit goes down** by its cash in hand (ledger `AGENT_REMOVED`); open Adjust requests are cancelled. Refused while the KO has open balance dues or an open settlement: 409 `KO_HAS_OPEN_CASH` "This KO still has open balance dues or an open settlement. Settle them (or replace the KO) before deleting it." Confirm text: "Delete <KO>? Its cash in hand (₹…) leaves your cash limit." Works without a running plan.

### 9.4 KO email and shared PCs (rev 26)

Any agent of a CSP (the CSP and all its KOs) may log in to SBI on **any PC of that CSP**; cash management on the desktop follows whoever logged in (automatically after the SBI kiosk fingerprint login, or by **email OTP** to the agent's email as the fallback). So:
- Ask for the **KO's email** in the KO form (and let the CSP edit it). The KO verifies it on the desktop (at PC activation or in the cash panel); the app only stores it.
- `PATCH /agents/:agentId` with a **different email** clears its verification (the KO verifies again on the desktop). Agent objects carry `emailVerifiedAt` (null = not verified): show "Email not verified" on the KO detail.
- Agents of other CSPs can't log in on your PCs.

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
- **A CSP** → the CSP **and all its KOs** (same as the CSP's own login). A CSP without KOs gets the single-agent view. Add **`includeKos=false`** for the CSP's own numbers only (single-agent view; e.g. "your own counter"). Also on `/dashboard/analytics`.
- **Omitted** → your whole scope (BC: all its CSPs and KOs; CSP: itself + its KOs).

The same rule applies to `GET /dashboard/analytics`, which used to ignore `agentId`.

Common fields:

```
overview:          { totalTransactions, successfulTransactions, failedTransactions, totalTransactionAmount, lastTransactionAt, successRate, failureRate }
services:          [{ transactionCategory, receiptType, successCount, failedCount, successAmount, failedAmount }]
servicesByCategory:[{ transactionCategory, totalCount, successCount, failedCount, pendingCount, successAmount }]   // all receipt types together, most-used first; use for the "services" tiles
cash:              { totals: { cashLimit, cashInAccount, cashInTransit, cashLeftInBank, cashOther*, cashDueExtra*, totalCashInHand, drawer, drawerTotal },
                     pools: [ <pool view, §13A> ] } | null   // null for CSP plans without CASH_MANAGEMENT; the agents in view only (agentId=KO → that KO)
                                                             // * CSP only: a BC gets the limit and its distribution, without cashOther / cashDueExtra (rev 25)
commission:        { today: { from, to, amount, successCount }, month: { from, to, amount, successCount } }   // rev 25
statusSummary:     { success, failed, total }
activationSummary: { total, used, unused }
recentTransactions:[{ receiptId, receiptType, transactionCategory, status, amount, transactionAt, customerName, customerAccount, rrn, stan }]
subscription:      { subscriptionNumber, subscriptionType, status, machineLimit, amountPaid, startDate, endDate, graceEndsAt, createdSource } | null
```

**Commission cards (rev 25):** `commission.today` = today (IST) and `commission.month` = the 1st of this month → today, for the agents in view (a CSP: itself + its KOs; a KO: what that KO generated; a BC: its CSPs). `amount` is ₹ earned by the CSP (rates set by the super admin, frozen per receipt; §13B), `successCount` the successful receipts counted. `from` / `to` are `YYYY-MM-DD`. They come from the daily counts, so they don't depend on the date filter of the rest of the summary. Tap → the Commission screen (§13B).

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

**Per PC (rev 23):** every list item and the detail have **`pc`**: `{ agent: { agentId, name, type } (the agent working on this PC), machineStatus, connectionStatus, lastHeartbeatAt, lastStartupAt, transaction: { count, amount, success, failed }, services: [{ transactionCategory, count }] }` for **this PC only**, in the requested range (counts follow the daily counts, §11). Use `pc` for a per-PC Machines tab; the other fields below stay the CSP unit's (CSP + KOs).

List item: `{ machine: { machineId, machineCode, machineName, watcherVersion, watcherEnabled, machineStatus, connectionStatus, lastHeartbeatAt, lastStartupAt, lastReceiptCapturedAt, ipAddress, deviceName, osName, osVersion }, agent: { agentId, name, type }, float: {…} | null, transaction: { count, amount, success, failed }, services: [...], children: [...] }`. **Use `item.machine.machineId` for detail calls.**

Detail: `{ machineId, machineCode, machineName, agent, status: { machineStatus, connectionStatus, lastHeartbeatAt, lastStartupAt }, runtime: { isSessionActive, sessionId, startedAt, onlineHours }, cspActivity: { isActive, agentId, activeSince, activeSeconds }, float, watcher: { version, enabled }, device, activity, overview, services, statusSummary, recentTransactions, children: [ per CSP/KO: agent fields + status + machine + transaction + services ] }`.

- `connectionStatus` is `ONLINE` when the last heartbeat is ≤ 120 s old (at most one missed heartbeat; was 180 s before rev 24). Show a green/grey dot; refresh the detail every 30–60 s.
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

**Optional receipt fields (rev 24): build the receipt screen from what comes back.** Which optional fields the desktop may send is decided by the **super admin**, and can change at any time (more fields switched on later, or off again). So receipts differ: an older receipt, or one from a PC that didn't have the field, has fewer fields; a newer one may have more. **Don't hard-code a fixed list of rows.**

- Every receipt detail has **`fields`**: only the optional fields **this** receipt has, in a fixed order, each with its display name:

  ```json
  "fields": [
    { "field": "rrn", "label": "RRN", "value": "123456789012" },
    { "field": "bankName", "label": "Bank name", "value": "SBI" },
    { "field": "customerName", "label": "Customer name", "value": "Asha" }
  ]
  ```

  Render one row per entry (`label`: `value`). When the super admin switches on a new field, it appears here on new receipts with no app change. Money-like values (`balanceAfter`) come as numbers: format them as ₹.
- The same values are also flat on the detail (`rrn`, `stan`, `terminalId`, `location`, `bankName`, `bankTransactionId`, `bankResponseCode`, `bankResponseMessage`, `balanceAfter`, `customerName`, `customerAccount`; `null` when missing) for screens that need one by name.
- **Defaults and extras (rev 25):** only `rrn` and `location` are **fixed defaults** (always on, `fixed: true`); the super admin picks any extra ones from a multi-select (`stan`, `terminalId`, `bankName`, `bankTransactionId`, `bankResponseCode`, `bankResponseMessage`, `balanceAfter`, `customerName`, `customerAccount`, `slip`). `slip` is not a text row: it means the PC uploads the slip image (below).
- **`GET /receipts/fields`** (any login) → `[{ field, label, personal, fixed, allowed }]`: every optional field, its display name and whether it's switched on now. Use it for filter chips, table / export column headers and an "about this receipt" legend; refetch on app start (it changes rarely).
- Fields that aren't allowed are never stored, so they can't appear later for that receipt. A receipt keeps the fields it was saved with even if the super admin later switches a field off.
- **There is no Aadhaar field** (and there won't be): remove `customerAadhaarMasked` from the app. Personal fields (`customerName`, `customerAccount`, `balanceAfter`; `personal: true`) are off by default.

`GET /receipts/:receiptId?agentId=<the receipt's agent>` (use **`receiptId`**, and send `agentId` from the list item: receipt numbers are unique per agent, so two agents can have the same one; outside your scope → 403) → `{ …, cashDenomination: { notes500, notes200, notes100, notes50, notes20, notes10, notes5, coins20, coins10, coins5, coins2, coins1 } | null, machine: { machineCode, machineName }, agent: { agentId, name, type } }`. `cashDenomination` is `null` when none was captured or the CSP plan lacks `CASH_MANAGEMENT`.

**Slip image, PDF, report a problem (rev 25)** — three actions on the receipt detail:

- **Slip:** when the detail has **`hasSlip: true`**, show a "View slip" button → `GET /receipts/:receiptId/slip?agentId=` → `data: { receiptId, url, expiresIn: 300 }`; open `url` (an image, JPEG/PNG/WebP) right away — it expires in 5 minutes, so fetch a new one each time (don't cache the URL). 404 `This receipt has no slip.` when there's none. Slips exist only when the super admin selected the `slip` field, and are deleted with the receipt after the retention period.
- **PDF:** "Download / Share PDF" → `GET /receipts/:receiptId/pdf?agentId=` with the bearer token → `application/pdf` (`Content-Disposition: attachment; filename="receipt-<receiptId>.pdf"`). Save it with `react-native-blob-util` / `expo-file-system` and open the share sheet (§17). It has the amount, status, date, service, agent, machine and the receipt's optional fields (amounts print as "Rs.").
- **Report a problem:** "Report a problem" → pick a reason → optional note → `POST /receipts/:receiptId/report?agentId=` `{ reason, details? }`. `reason`: `WRONG_AMOUNT` (Wrong amount), `WRONG_STATUS` (Wrong status), `DUPLICATE` (Duplicate receipt), `MISSING_DETAILS` (Missing or wrong details), `NOT_MY_TRANSACTION` (Not my transaction), `OTHER` (Other — `details` required, max 1000). → 201 `Problem reported. The support team will look into it.` `data: { id, receiptId, ownerAgentId, reportedBy, reason, reasonLabel, details, status: "OPEN", resolution: null, resolvedAt: null, createdAt, receipt: { amount, status, transactionCategory, transactionAt } }`. 409 `This receipt already has an open problem report.` (one open report per receipt). The super admin resolves or rejects it with a note.
- **My reports:** `GET /receipts/reports?status=OPEN|RESOLVED|REJECTED` → the newest 100 reports on receipts in your scope (or raised by you), same item shape. Show `status` + `resolution` ("What was done"). The report keeps its own copy of the receipt, so it stays readable after the receipt itself is deleted by retention. No push yet: refresh on screen focus.

`GET /receipts/stats` (same filters) → `{ total, success, failed, totalAmount }`. Without `search` it reads the daily counts (up to a year back); with `search` it counts receipts (last 60 days). With `status=SUCCESS`, `failed` is now `0` (older builds ignored the filter for `failed`).

**Retention:** the list, detail and export return receipts from the retention period only (60 days by default, set by the super admin, at least 15). Older ones are deleted on the server; their counts stay in dashboards and reports. When a range returns nothing, show "Older transactions aren't kept; counts are in Reports".
`GET /receipts/export` (same filters, including `agentIds`, `receiptTypes`, `transactionCategories` and `period`) → Excel file (§17). Example: yesterday's withdrawals of two KOs: `/receipts/export?period=YESTERDAY&agentIds=KO1,KO2&transactionCategories=CASH_WITHDRAWAL`. `/receipts/stats` takes the same filters.

Enums for filters:
- `transactionCategory`: `CASH_DEPOSIT`, `CASH_WITHDRAWAL`, `MONEY_TRANSFER`, `FUND_TRANSFER`, `BALANCE_ENQUIRY`, `MINI_STATEMENT`, `ACCOUNT_OPENING`, `BBPS`, `MICRO_ATM`, `SOCIAL_SECURITY`, `PASSBOOK_PRINTING`, `LOAN`, `OTHER`
- `receiptType`: `AEPS`, `ACCOUNT`, `CARD`, `BBPS`, `MICRO_ATM`, `ACCOUNT_OPENING`, `APY`, `PMJJBY`, `PMSBY`, `MUDRA_LOAN`, `PASSBOOK`, `UNKNOWN`

`receiptId` is unique **per agent** (two agents can have the same value). Open a receipt from the list item you have; `GET /receipts/:receiptId` is limited to your scope.

`amount` is `null` for receipts without an amount (balance enquiry, mini statement…; list and detail, rev 23): show "—", not ₹0. Only cash deposit, cash withdrawal and money transfer move the float.

## 13A. Cash management (CSP + KOs)

> **Rev 26: the cash limit is worked out, never entered or checked.** Read 13A.9–13A.13 for the new flows (direct edit, increase / decrease, Adjust requests, activation differences). Cash management needs `CSP_COMPLETE` (§7): on `CSP_AUTOMATION` every cash call answers 403 `PLAN_UPGRADE_REQUIRED`.

A CSP and its KOs share **one cash in account (holding)**: the **pool**. Each agent (the CSP and each KO) has its **own cash in hand** and its own **drawer** (note/coin counts); a KO's desktop shows only its own cash in hand and drawer, but the **cash in account is the same for everyone** in the CSP. The **cash limit** is the result (rev 26):

```
cash limit = cash in hand (CSP) + cash in hand (every KO) + cash in account + in bank (open KO settlements) + left in bank + extra cash held by dues − other cash
```

The CSP never types a limit; it moves whenever cash comes in or goes out (a KO given more cash than the CSP had, an increase / decrease, a KO's "other" difference at activation, a KO deleted). There's **no comparison with the limit anywhere** (nothing is refused because of it).

**Extra cash held by dues** (`cashDueExtra`, + to collect, − to give) is what the KOs' open balance dues put on "extra cash" are worth; it moves with other cash so the books balance. Show it read-only next to other cash.

**Other cash** (`cashOther`, + or −) is cash that came in from (or went out to) outside SBI on the desktop: custom transactions (shop expenses, bill collections) and settled balance dues. It's 0 until a KO records one; the CSP clears it with an ADJUSTMENT (`cashOther`).

Nothing ever goes below ₹0. Who can do what:

| | CSP | BC | Super admin | KO (desktop) |
|---|---|---|---|---|
| View pool, every agent's cash in hand and drawer, ledger, requests | yes | yes (send `agentId`) | yes (send `agentId`) | own cash only (heartbeat) |
| Settle, edit (cash in account, any agent's cash in hand incl. its own, drawer), increase / decrease (rev 26) | yes | no | no | no |
| Count notes for the CSP's cash in hand changes (Adjust request, rev 26) | sees them | no | no | does it on the desktop (mandatory) |
| KO settlements (cash in account ↔ bank ↔ cash in hand) | **informed only** (feed) | sees them | sees them | starts and approves its own, from the desktop |
| Approve / reject a KO's change request | yes | no | no | asks from the desktop |
| Labels for custom transactions | create, rename, deactivate | sees them | sees them | picks one |
| Balance due, day closes | sees every agent's | sees them | sees them | records its own |
| Tasks | sees all; adds / edits / deletes the ones it gives | sees them | sees them | its own; ticks the CSP's done |

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
| ~~Limit raised / lowered~~ | rev 26: the limit can't be set | |
| KO added with cash in hand X (rev 26) | KO + X; CSP − min(X, CSP's cash in hand) (or the edited rows) | — (limit + whatever wasn't covered) |
| PC activated: the agent counts Y (CSP gave X), difference from / to **cash in account** (rev 26) | set to Y; drawer set to the count | − (Y − X) (limit unchanged) |
| PC activated: difference **other** (cash brought / taken by the CSP) (rev 26) | set to Y | — (limit + (Y − X); CSP notified) |
| CSP increases / decreases an agent's cash in hand by A (rev 26) | + A / − A (Adjust request for the notes) | — (limit + A / − A) |
| CSP increases / decreases cash in account by A (rev 26) | — | + A / − A (limit + A / − A) |
| CSP edits cash in hand / cash in account directly (rev 26) | set | set (limit worked out again) |
| KO deleted (rev 26) | its cash in hand → 0 | — (limit − its cash in hand) |
| KO replaced (rev 26) | moves to the new KO | — |
| Desktop one-step transfer hand ⇄ account (rev 26) | − A / + A | + A / − A |
| Custom transaction IN / OUT (paid now P) | + P / − P | — (other cash + P / − P) |
| Balance due settled: collected / given A | + A / − A | — (other cash + A / − A) |
| Balance due added for an applied receipt (A unpaid): to collect / to give | − A / + A | — (other cash − A / + A) |
| Balance due added on **cash in hand** (A): to collect / to give | + A / − A | − A / + A |
| Balance due added on **cash in account** (A): to collect / to give | − A / + A | + A / − A |
| Balance due added on **extra cash** (A): to collect / to give | — | — (other cash and extra cash held by dues + A / − A) |
| That due settled / cancelled | the side moves back (for the part paid / still due), then the notes come in / go out as above | |
| Cash exchange, day close | — (exchange swaps notes only) | — |

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
  "cashInTransit": 0, "cashLeftInBank": 0, "cashOther": 0, "cashDueExtra": 0, "pendingRequests": 1, "openSettlements": 0, "updatedAt": "…"
}
```

**Rev 26 fields:** each agent also has **`machineActive`** (it has a running PC: its desktop counts notes; the CSP's own cash in hand can be increased / decreased only then) and **`pendingAdjustments`** (open Adjust requests: show "Waiting for notes" on its row); the pool adds **`balanceDue`** (= `cashDueExtra`, the balance due held in the books, part of the limit).

**Dashboard / Cash tab totals (rev 26):** by default show everything **together**: total cash in hand of all KOs + the CSP (`totalCashInHand`), cash in account, balance due (`balanceDue`), the **cash limit** (excluding other cash: `cashLimit` already subtracts it; show other cash separately) and the merged denomination (`drawer`). A segmented control "All / <each agent>" switches to one agent (`agents[]`, or `?agentId=`). The dashboard `cash` block has the same totals.

`setUp: false` (cash in account `null`) is a CSP that existed before cash management. Show a "Set up cash" screen that sends one ADJUSTMENT with `cashInAccount` and each agent's `cashInHand` (rev 26: no `cashLimit`; the limit is their sum). Agents may already show a cash in hand: a KO counts it when activating a PC, and it's kept until setup. Money values are numbers in rupees (2 decimals).

### `POST /cash-management/transactions` (CSP) — settle or adjust

Optional header `Idempotency-Key` (8–128 chars): a retry with the same key returns 200 `Already recorded (same Idempotency-Key).` without applying twice; the same key for a different request → 409. Send a new key per tap. There's no daily limit on settlements. Response 201 (`Settlement recorded.` / `Cash adjusted.`) with the updated pool view.

**Settlement** moves cash between cash in account and one agent's cash in hand:

```json
{ "type": "SETTLEMENT", "agentId": "KO-001", "amount": 50000, "direction": "ACCOUNT_TO_HAND", "remarks": "Cash for withdrawals" }
```

`direction`: `ACCOUNT_TO_HAND` | `HAND_TO_ACCOUNT`; `amount` > 0. Errors (400): `Not enough cash in account: ₹… available, ₹… needed.`, `Not enough cash in hand: …`, `Agent … isn't part of this CSP.`, `Cash management isn't set up for this CSP yet. …`. Example: limit 1L, cash in account 95K, KO cash in hand 5K; settle 50K → cash in account 45K, KO cash in hand 55K.

**Adjustment** (rev 26: "Edit cash") sets values by hand: any agent's cash in hand (its own too), the cash in account, the drawer, left in bank / other cash, first setup. `remarks` is required; send only what changes. **`cashLimit` is refused** (400 "The cash limit can't be set: it is cash in hand + cash in account (+ balance due). Change those instead."). The limit is worked out again from the result; nothing is compared. Every agent whose cash in hand changed **without** a `drawer` gets a mandatory Adjust request (13A.11).

```json
{ "type": "ADJUSTMENT", "cashInAccount": 60000, "agents": [{ "agentId": "KO-001", "cashInHand": 55000, "drawer": { "notes500": 100, "notes100": 50 } }], "remarks": "Counted the drawer" }
{ "type": "ADJUSTMENT", "cashLeftInBank": 0, "cashInAccount": 53500, "remarks": "Bank returned the rest" }
{ "type": "ADJUSTMENT", "cashOther": 0, "cashInAccount": 44400, "remarks": "Shop cash counted into the books" }
```

Rules:
- ~~A new `cashLimit` …~~ / ~~must equal the cash limit~~ — removed in rev 26: no limit input, no equality check.
- `cashLeftInBank` sets what partly delivered KO settlements left in bank, e.g. to 0 when the bank returns it (raise `cashInAccount` by the same amount). Audited like every adjustment (ledger `cashLeftInBankChange`). 400 `Nothing is left in bank before cash management is set up.` when there's no pool yet.
- `cashOther` sets the net cash from custom transactions and dues (may be negative), e.g. to 0 once the CSP has accounted for it (the limit follows). 400 `There's no other cash before cash management is set up.` with no pool.
- The CSP's direct `SETTLEMENT` and every `ADJUSTMENT` are in the ledger with `actorType: USER` and the user's id.
- Nothing below 0: 400 `Cash in hand and cash in account can't be below ₹0.00.`
- Drawer keys you leave out keep their count.
- Other 400s: `Remarks are required.`, `Nothing to change.`, `Each agent can appear only once.`

### `GET /cash-management/ledger` — audit

Query: `agentId` (as for the pool), `agentIds` (one or more agents individually; omit for all agents merged), `types` (`OPENING`, `AGENT_ADDED`, `RECEIPT`, `RECEIPT_NOT_APPLIED`, `SETTLEMENT`, `ADJUSTMENT`, `REQUEST_APPROVED`, `ACTIVATION`, `SETTLEMENT_TO_BANK`, `SETTLEMENT_FROM_BANK`, `SETTLEMENT_HELD`, `SETTLEMENT_CANCELLED`, `CUSTOM`, `DUE_CREATED`, `DUE_SETTLED`, `DUE_CANCELLED`, `EXCHANGE`, `DAY_CLOSE`; several allowed), `period` / `from` / `to` (as in §13), `page`, `limit` (≤100). Newest first.

`ACTIVATION` entries are the cash in hand and drawer counted on the desktop when a PC is activated.

Item: `{ id, type, reason, agentId, agentName, agentType, transactionCategory, amount, cashInHandChange, cashInAccountChange, cashLimitChange, cashInTransitChange, cashLeftInBankChange, cashOtherChange, cashDueExtraChange, balanceCashInHand, balanceCashInAccount, balanceCashLimit, balanceCashInTransit, balanceCashLeftInBank, balanceCashOther, balanceCashDueExtra, drawerChange, receiptId, requestId, settlementId, actorType (USER|MACHINE|SYSTEM), actorId (userId or machineCode), remarks, createdAt }` + `pagination`. Every change, from the app or the desktop, is recorded here.

### KO settlements (the KO approves its own; the CSP is informed)

A KO settles from its desktop, in two steps it approves itself; **the CSP doesn't approve anything**, it just sees what happens (push notifications later: checklist 2.16):

| Direction | Step 1 (KO creates) | Step 2 (opens when the KO approves step 1) |
|---|---|---|
| `ACCOUNT_TO_HAND` | cash in account → bank: the amount is taken out of the shared cash in account at once and held "in bank" | bank → cash in hand: the KO enters the notes received (total ≤ amount); they go into its drawer and cash in hand; any difference stays **left in bank** |
| `HAND_TO_ACCOUNT` | cash in hand → bank: amount + the notes taken out of the drawer | bank → cash in account: the KO enters the amount credited (≤ amount; default all); any difference stays **left in bank** |
| `BANK_TO_HAND` | — (one step only) | left in bank → cash in hand: the amount is taken out of **left in bank** at once and held; the KO approves with the notes received (total ≤ amount); any difference goes back to left in bank |

While a step is open, the amount is in `cashInTransit` (pool view, dashboard, heartbeat), so every other KO already sees the lower cash in account. A KO can cancel an open step: the money (and notes) go back where they came from. A step is never shared between KOs. **One open settlement per KO at a time** (step 1 or step 2): a second one gets 409 `This agent already has an open settlement. Approve or cancel it first.`

**Left in bank** (`cashLeftInBank` on the pool view and dashboard cash totals; `leftInBank` per settlement step): what step 2 didn't deliver. Show it **separately** from cash in account and "in bank". A KO brings it back into its cash in hand with a `BANK_TO_HAND` settlement from the desktop; the CSP can also correct it with an ADJUSTMENT (`cashLeftInBank`).

**`GET /cash-management/settlements`** (CSP, BC, super admin): the feed. Query: `agentId` (as for the pool), `agentIds`, `status` (`PENDING`, `APPROVED`, `CANCELLED`), `period` / `from` / `to`, `page`, `limit`. Item: `{ id, cspAgentId, agentId, agentName, direction, step (TO_BANK|FROM_BANK), label ("Cash in account → bank", …), status, amount, settledAmount, leftInBank (step 2: amount − settledAmount), requestId (both steps of one request share it), requestStartedAt, stepNumber, stepCount, previousStep ({ id, approvedAt, amount } on step 2), drawer, needsDenomination, parentId (step 2 → step 1), remarks, requestedBy, reviewedBy (machineCode), reviewedAt, createdAt }` + `pagination`. `openSettlements` on the pool view is the badge count. Every money move is also in the ledger as `SETTLEMENT_TO_BANK`, `SETTLEMENT_FROM_BANK`, `SETTLEMENT_HELD` (left in bank held for a `BANK_TO_HAND`), `SETTLEMENT_CANCELLED` (with `settlementId`, `cashInTransitChange`, `balanceCashInTransit`).

The CSP's own `SETTLEMENT` above (`POST /cash-management/transactions`) still works for direct moves (e.g. the CSP's own cash in hand). It's in the audit like every CSP action (`actorType: USER`). An ADJUSTMENT must account for what's in bank and left in bank: cash in account + all cash in hand + in bank + left in bank = limit.

### KO change requests

A KO can't change its cash itself. From the desktop it asks for a new cash in hand (and drawer), and the CSP approves or rejects it.

- `GET /cash-management/requests?status=PENDING|APPROVED|REJECTED&agentId=&page=&limit=` → items `{ id, cspAgentId, agentId, requestedCashInHand, systemCashInHand (at the time of the request), requestedDrawer, reason, status, requestedBy (machineCode), reviewedBy, reviewedAt, reviewRemarks, createdAt }`. `pendingRequests` on the pool view is the badge count.
- `POST /cash-management/requests/:requestId/review` (CSP) `{ "action": "APPROVE" | "REJECT", "remarks"? }`. Approving sets the KO's cash in hand to the requested value; the difference comes from (or goes back to) cash in account. Errors: 400 `Not enough cash in account to approve: …` (the request stays pending); 409 `This request has already been reviewed.`; 404 `Cash request not found.`

### Labels for the KOs' custom transactions

KOs record cash that moves outside SBI (shop expenses, bill collections, recharges) on the desktop, picking one of the CSP's labels.

- A new pool starts with four editable labels: **Other** (`BOTH`), **Shop expense** (`OUT`), **Bill collection** (`IN`), **Recharge** (`IN`).
- `GET /cash-management/labels?agentId=` (CSP, BC, super admin) → `data: [ { id, name, direction: "IN"|"OUT"|"BOTH", active, createdAt, updatedAt } ]`, active first.
- `POST /cash-management/labels` (CSP) `{ "name": "Electricity bill collection", "direction": "IN" }` → 201 `Label created.`
- `PATCH /cash-management/labels/:labelId` (CSP) any of `{ name, direction, active }` → 200 `Label updated.` Deactivate with `active: false`; old transactions keep the name they were made with.
- Errors: 409 `A label with this name already exists.` (case-insensitive), 404 `Label not found.`, 400 `Name is required.` / `Keep the name under 60 characters.` / `Nothing to change.`

### Balance due (read-only)

Work a KO did but hasn't been paid for (or still owes change). The KO records and settles them on the desktop.

`GET /cash-management/dues?agentId=&status=OPEN|CLOSED` → `data: { dues: [ { id, agentId, agentName, kind: "TO_COLLECT"|"TO_GIVE", amount (still due), originalAmount, source: "RECEIPT"|"CUSTOM"|"MANUAL", receiptId, customTransactionId, label, note, status, cashSide ("CASH_IN_HAND" | "CASH_IN_ACCOUNT" | "OTHER_CASH" | null), createdAt, settledAt } ], totals: { toCollect, collectCount, toGive, giveCount } }`. Show `cashSide` as "added to cash in hand" / "deducted from cash in account" / "… extra cash" (to collect = added, to give = deducted); null = nothing was moved.

**`GET /cash-management/dues/:dueId?agentId=`** → the due + `agentName` + **`events`** (oldest first): `[{ type: "CREATED" | "PART_SETTLED" | "SETTLED" | "CANCELLED", amount, stillDue, cashSide, cashInHandChange, cashInAccountChange, cashOtherChange, drawerChange, machineCode, remarks, createdAt }]` for the Due detail "History". 404 `Due not found.` OPEN oldest first; CLOSED = settled or cancelled in the last 14 days. No `agentId` = the CSP and all its KOs.

### Day closes (read-only)

At the end of the day a KO counts its drawer on the desktop. Closing changes nothing; a difference is fixed through a KO change request.

`GET /cash-management/day-closes?agentId=&from=YYYY-MM-DD&to=YYYY-MM-DD` (default the last 14 days) → `data: { today: [ { agentId, agentName, status: "CLOSED"|"OPEN" } ], items: [ { dayId, agentId, agentName, date, system: { cashInHand, drawer }, counted: { cashInHand, drawer }, difference (negative = short), result ("Matched" / "₹500 short" / "₹500 over"), closedAt } ] }`.

### Tasks

To-dos shared between the CSP and its agents. A KO manages its own on the desktop and can only tick the CSP's done.

- `GET /cash-management/tasks?agentId=&status=OPEN|DONE|ALL` → `data: [ { id, agentId, agentName, title, note, dueAt, done, doneAt, createdBy: "KO"|"CSP", createdAt, updatedAt } ]`: open (soonest due first), then done in the last 30 days. Overdue = not done and `dueAt` in the past.
- `POST /cash-management/tasks` (CSP) `{ "agentId": "KO-001", "title": "…", "note"?: "…", "dueAt"?: "ISO" }` → 201 `Task added.` (`createdBy: "CSP"`).
- `PATCH /cash-management/tasks/:taskId` (CSP) any of `{ title, note, dueAt, done }`; `DELETE /cash-management/tasks/:taskId` (CSP). Only the CSP's own tasks: 403 `This task is the agent's own. Only they can change it.`; 404 `That task isn't there any more.` (not in your CSP); 404 `Agent not found.` on create for an agent outside your CSP.
- Validation: `Write what needs doing.`, `Keep it under 100 characters.`, `Keep the note under 300 characters.`, `Use an ISO date and time.` Task text may hold customer details: don't log it.

### Screens (suggested)

- **Cash (CSP):** limit, cash in account, in bank, total cash in hand; a card per agent (cash in hand, drawer, mismatch badge); "Settle" and "Adjust" actions; a "Requests" badge; a "Settlements" feed with an open count; a "To fix" list (ledger `types=RECEIPT_NOT_APPLIED`).
- **Cash (BC, read-only):** the same view per CSP.
- **Other cash, dues, day closes, tasks (CSP):** "Other cash" next to left in bank; a Balance due list per KO (to collect / to give); a "Today" strip with each KO's day close (closed, short, over, not closed); Tasks per KO (open, overdue, done) with "Add task"; Labels under settings.
- **Ledger:** filters for agent(s), type and period.

### 13A.9 Ledger types and reasons added in rev 26

`types` filter adds `INCREASE`, `DECREASE` (reason `CASH_IN_HAND` / `CASH_IN_ACCOUNT`), `DRAWER_ADJUSTED` (the agent counted notes for an Adjust request), `AGENT_REMOVED` (KO deleted), `AGENT_TRANSFERRED` (KO replaced, two rows), `TRANSFER` (desktop one-step hand ⇄ account). `ADJUSTMENT` rows from KO creation have `reason: "KO_CREATION"`; `AGENT_ADDED` rows carry `cashLimitChange`. `ACTIVATION` rows have `reason` `DIFFERENCE_FROM_CASH_IN_ACCOUNT`, `DIFFERENCE_TO_CASH_IN_ACCOUNT`, `OTHER_INCREASED_BY_CSP`, `OTHER_DECREASED_BY_CSP` (or null when the count matched) and `amount` = the difference. Every row keeps `actorType` / `actorId` (USER = CSP's userId, MACHINE = machineCode): the audit trail the owner asked for.

### 13A.10 Increase / decrease cash (rev 26, new button)

On the Cash tab, a **"Cash in / out"** button (only with `screens.cash`). Sheet:

```
[ Increase ▾ | Decrease ]
Where:   ( ) Cash in hand of: [ KO-001 ▾ ]     ( ) Cash in account
Amount:  [ 10,000 ]     Remarks: [ Gave cash for withdrawals ]     [Save]
```
- The agent picker lists the KOs and **the CSP itself only when `machineActive`** is true for it (its desktop counts the notes). Without a PC, the CSP's own cash goes through **cash in account**: if it's picked anyway → 400 `CSP_HAND_NEEDS_MACHINE` "You don't have a running machine, so your cash in hand isn't counted on a desktop. Change the cash in account instead."
- `POST /cash-management/transactions` (+ `Idempotency-Key`):
  ```json
  { "type": "INCREASE", "target": "CASH_IN_HAND", "agentId": "KO-001", "amount": 10000, "remarks": "Gave cash" }
  { "type": "DECREASE", "target": "CASH_IN_ACCOUNT", "amount": 5000, "remarks": "Withdrew for the shop" }
  ```
  → 201 with the pool view; message "Cash in hand increased. The agent counts the notes on the desktop (Adjust request)." / "Cash in account decreased."
- The **cash limit moves by the amount** (+ / −); nothing is compared with it. Can't go below 0: 400 `Not enough cash in hand: ₹… available, ₹… to take out.` / `Not enough cash in account: …`.
- A cash in hand change creates an **Adjust request** for that agent (13A.11). Audited (ledger `INCREASE` / `DECREASE`).
- Errors: 400 `agentId is required to change an agent's cash in hand.`, `Agent … isn't part of this CSP.`, `Remarks are required.`

### 13A.11 Adjust requests (rev 26) — the agent counts the notes

Whenever the CSP changes an agent's cash in hand from the app — **KO creation** (rows it took cash from / gave to), **edit** (ADJUSTMENT without a drawer), **increase / decrease** — the server creates a **mandatory Adjust request** for that agent. On its desktop (whichever PC it's logged in on) the agent sees it with an **[Adjust]** button that opens the denomination modal with its current notes; it enters the notes given / taken (or recounts the whole drawer) so the drawer total matches the new cash in hand. Until it's done, the agent's other desktop cash actions are refused (409 `ADJUSTMENT_PENDING`); receipts still upload and apply.

`GET /cash-management/adjustments?agentId=&status=PENDING|COMPLETED|CANCELLED` (CSP, super admin) →
```json
"data": [ { "id": "…", "agentId": "KO-001", "source": "CSP_INCREASE",          // KO_CREATION | CSP_EDIT | CSP_INCREASE | CSP_DECREASE
            "status": "PENDING", "kind": "GIVEN", "amount": 10000,             // GIVEN = CSP gave cash; TAKEN = CSP took it
            "cashInHandBefore": 45000, "cashInHandAfter": 55000,
            "drawerBefore": { … }, "drawerAfter": null, "mandatory": true,
            "remarks": "Gave cash", "requestedBy": "<userId>", "completedAt": null, "completedBy": null, "createdAt": "…" } ]
```
Show on the agent's row "Waiting for notes (₹10,000 given)" and in the Requests inbox; `COMPLETED` rows show `drawerAfter` and the PC (`completedBy`). The pool view's `agents[].pendingAdjustments` is the count. Only shown for plans with cash management.

### 13A.12 KO's first PC activation: cash in hand difference (rev 26)

The KO's desktop activation form is **pre-filled with the cash in hand the CSP gave** (e.g. ₹60,000, editable) and asks for the denomination. If the KO counts a different amount, it chooses where the difference came from / went to:

| KO counted | Chooses | Effect | CSP |
|---|---|---|---|
| more than given | **Cash in account** | difference taken from cash in account → KO's cash in hand; limit unchanged | ledger only |
| more than given | **Other** (cash increased by the CSP) | only the KO's cash in hand goes up; **limit + difference** | **notified** |
| less than given | **Cash in account** | difference added to cash in account; limit unchanged | ledger only |
| less than given | **Other** (cash decreased by the CSP) | only the KO's cash in hand goes down; **limit − difference** | **notified** |

The KO's new cash in hand is always what it counted. Every case is audited (ledger `ACTIVATION` with `reason`, 13A.9). The notification (§13D, `kind: CASH_ACTIVATION_DIFFERENCE`) reads e.g. "Ravi (KO-002) counted ₹55,000.00 at machine activation, ₹5,000.00 more than the ₹50,000.00 you gave. Marked as other (cash increased by you): the cash limit is now ₹1,15,000.00." with `data: { agentId, machineCode, given, counted, difference, differenceSource }`. Show it in the bell and as a banner on the Cash tab until read.

### 13A.13 Cash screens (rev 26 additions)

- **Cash tab header:** All / per agent switch; cards Cash in hand (total), Cash in account, Balance due, **Cash limit (worked out)**, Other cash; merged denomination.
- **Agent row:** cash in hand, drawer total, "PC on" chip (`machineActive`), "Waiting for notes" chip (`pendingAdjustments > 0`), tap → agent detail with Edit cash / Cash in / out.
- **Edit cash sheet:** cash in account + each agent's cash in hand (incl. the CSP); preview the new limit locally (= Σ cash in hand + cash in account + in bank + left in bank + balance due − other cash) before saving.
- Remove every "CSP limit" input and every "must equal the limit" message from the app.

## 13B. Commission (CSP)

**Who earns:** only the **CSP**. A KO is paid a salary by its CSP, so every successful receipt of the CSP **or of its KOs** earns commission for the CSP. Commission is earned **by month** (the Home hero shows this month so far; "Monthly" lists past months).

**Rates** are set by the super admin per service: `FLAT` (₹ per transaction / enrolment), `PERCENT` (of the amount, optional min / max per receipt) or **`SLAB`** (rev 25: amount bands, e.g. ₹0–1000 → ₹5, ₹1000+ → 1%; each band FLAT or PERCENT; optional min / max per receipt). For a SLAB rate `rate` is `null` and **`slabs`** lists the bands `[{ from, to (null = and above), type: FLAT|PERCENT, amount?, percent? }]` (`from` inclusive, `to` exclusive); `rateLabel` reads `₹0–1000: ₹5; ₹1000+: 1% (max ₹25)` — show `rateLabel`, or a small table from `slabs`. A rate can be the default for everyone, or an override for one BC's CSPs or for one CSP (CSP > BC > default). New rates start now or later, never in the past: the rate is frozen on each receipt when it's uploaded, so past days never change. Failed receipts earn nothing. With no rate set a service earns ₹0.

Services (`serviceCode`): `CW`, `CD`, `MT`, `FT`, `MATM`, `BBPS`, `LOAN` (FINANCIAL); `BE`, `MS`, `PB` (NON_FINANCIAL); `AO`, `PMJJBY`, `PMSBY`, `APY`, `SS_OTHER` (ENROLMENT).

| Call | Who | Notes |
|---|---|---|
| `GET /commission/summary?period=TODAY\|WEEK\|MONTH&month=YYYY-MM&agentId=` | CSP, BC, super admin | default `MONTH` (1st → today); `month` = a whole past month; `WEEK` = Monday → today (IST). `agentId`: a CSP = the CSP + its KOs (what the CSP earned); a KO = what that KO generated; none = your scope (BC: all its CSPs) |
| `GET /commission/months?count=12&agentId=` | CSP, BC, super admin | monthly totals, newest first: `[{ month, total, successCount, isCurrent }]` (kept 12 months) |
| `GET /commission/rates?agentId=` | CSP (its own), BC / super admin (`agentId` = a CSP or KO, required) | the live rate of every service after precedence: `{ cspAgentId, effectiveFrom, rates: [{ serviceCode, serviceName, transactionCategory, receiptType, group, rateType, rate, minAmount, maxAmount, rateLabel, scope (DEFAULT\|BC\|CSP), unit (TRANSACTION\|ENROLMENT) }] }` |

Summary `data`:

```json
{ "period": "MONTH", "month": null, "from": "2026-11-01", "to": "2026-11-04",
  "total": 1840, "previousTotal": 1612, "monthToDate": 1840,
  "successCount": 152, "excludedFailedCount": 4,
  "groups": { "FINANCIAL": 1516, "NON_FINANCIAL": 38, "ENROLMENT": 286 },
  "rows": [ { "serviceCode": "CW", "serviceName": "Cash withdrawal", "transactionCategory": "CASH_WITHDRAWAL", "receiptType": null,
              "group": "FINANCIAL", "count": 64, "rateType": "FLAT", "rate": 15, "rateLabel": "₹15", "amount": 960 } ],
  "byAgent": [ { "agentId": "KO-0012", "name": "Suresh", "type": "KO", "amount": 980 } ],
  "updatedAt": "…" }
```

- `rows`: every active service, also with count 0; `rateLabel` / `rate` are the live rate when the view is one CSP (else `null`).
- `previousTotal`: the same period one step back (yesterday / last week / last month to the same day; a whole month for `month=`).
- `byAgent`: where it was generated (all of it belongs to the CSP). Show it on the KO detail as "Commission generated", not "earned".
- Commission totals come from the daily counts, so they stay after receipts are deleted (retention).

Also: the dashboard summary has `commission.today` / `commission.month` (§11, rev 25); `GET /receipts/stats` adds `commissionAmount`; `GET /receipts/:receiptId` adds `commission: { amount, rateLabel } | null` (null = no commission service for that receipt).

## 13C. Team today (CSP)

Per agent of the CSP (the CSP and its KOs), from their PCs:

- **Online time**: a PC's session is on while its heartbeats arrive with at most **one** missed (a PC is offline after 120 s without a heartbeat).
- **Active time**: SBI work started and stopped on the desktop (activity start → stop).
- **Late / early**: against the working day **the CSP sets**.

`GET /team/today?date=YYYY-MM-DD&agentId=` (CSP, BC, super admin; default today, IST; `agentId` as for the dashboard):

```json
"data": { "date": "2026-11-04", "startTime": "09:30", "endTime": "18:30",
  "members": [ { "agentId": "KO-0014", "name": "Asha Mehra", "type": "KO",
    "machineName": "Village kiosk", "machines": [ { "machineCode": "MAC-…", "machineName": "Village kiosk" } ],
    "online": false, "status": "OFFLINE",
    "firstLoginAt": "2026-11-04T04:45:00.000Z", "lastSeenAt": "2026-11-04T10:50:00.000Z",
    "onlineSeconds": 21900, "activeSeconds": 15300, "lateMinutes": 45, "earlyLeaveMinutes": 0 } ] }
```

- `status`: `ONLINE`, `OFFLINE`, `NOT_LOGGED_IN` (no login yet and the start time has passed), `NOT_STARTED` (no login, before the start time or no start time set).
- `lateMinutes`: first login after `startTime` (0 when on time or no start time). `earlyLeaveMinutes`: last heartbeat before `endTime` once the closing time has passed and the PC is offline.
- `startTime` / `endTime` are shown when the view is one CSP.

`GET /team/settings` / `PATCH /team/settings { "workdayStart": "09:30" | null, "workdayEnd": "18:30" | null }` (CSP): its team's working day (`HH:mm`, IST). 400 `Use a time like 09:30.`, `The start time must be before the closing time.`

## 13D. Notifications (rev 26)

In-app notifications for the CSP (and BC) login. Push isn't built yet (pre-production checklist 2.14): poll `GET /notifications?unreadOnly=true&limit=1` every 60 s while the app is open (and on resume) for the badge.

| Call | Notes |
|---|---|
| `GET /notifications?unreadOnly=&page=&limit=` | newest first → `{ items: [{ id, title, message, type: INFO\|SUCCESS\|WARNING\|ERROR, kind, data, isRead, readAt, createdAt }], unread, pagination }` |
| `POST /notifications/:id/read` | mark one read; `:id` = `all` marks every unread one |

`kind` → where to go on tap: `CASH_ACTIVATION_DIFFERENCE` → Cash tab, that agent (`data.agentId`); `SUBSCRIPTION_RENEWED` / `SUBSCRIPTION_RENEWAL_FAILED` / `SUBSCRIPTION_LAPSED` / `SUBSCRIPTION_CANCELLED` / `MANDATE_REVOKED` / `MANDATE_REPLACED` (rev 27) → Subscription screen (refetch `/subscriptions/access`); `GENERAL` → nothing.

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
| OTP emails are a console stub on the server | signup / reset OTPs aren't delivered yet (dev: read them from the server log) | email provider before launch |
| Payments are manual (no Razorpay yet) | don't ship checkout to production | checklist 1.1–1.5 |
| No push notifications / activation emails yet | poll lists for link approvals and machine status; show passwords from the assign response | planned (§5.2) |
| `POST /auth/check-agent` returns the full agent record | only use `success` | backend to trim |
| No unlink endpoint for BC↔CSP | can't undo a link from the app | Super Admin/backend |
| `cashLimit`/`openingCash` are ignored when an existing CSP is requested via `POST /agents/csp` | the CSP keeps its own values | by design for now |
| UPI autopay (Razorpay) not integrated (rev 26) | dev mandates are ACTIVE at once and charges succeed; no real UPI approval screen | checklist 1.10 |
| A purchase after a cancel starts now (the cancelled plan's remaining days are lost) (rev 26) | warn before payment (§6A.5) | confirmed by the owner (rev 27) |
| Agent / KO email OTPs are a console stub (rev 26) | desktop email verification / cash login OTPs aren't delivered yet | email provider before launch |

### 19.1 Backend requirements from the mobile app

**Backend status (rev 23, 2026-11-04):**

| # | Requirement | Status |
|---|---|---|
| R1 | Fix the 2-decimal money check (floating point refused e.g. `0.07`, `1000.29`) | **Done.** Tolerant check in `common.validator.ts`; 3 decimals are still refused. |
| R2 | `POST /auth/refresh` | **Done** (§5.2): rotation, reuse detection, plus `POST /auth/logout`. |
| R3 | Stable `code` on the 403 / 409 answers the app branches on | **Done** (§3): `ACCOUNT_NOT_VERIFIED`, `ACCOUNT_EXISTS`, `INVALID_CREDENTIALS`, `ACCOUNT_BLOCKED`, `ACCOUNT_SUSPENDED`, `KO_NO_LOGIN`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED`, `OTP_NOT_FOUND`, `OTP_RESEND_TOO_SOON`, `OTP_RESEND_LIMIT`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `TOKEN_REQUIRED`, `REFRESH_TOKEN_INVALID`, `SUBSCRIPTION_NONE`, `SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_SUSPENDED`, `SUBSCRIPTION_CANCELLED`, `SUBSCRIPTION_PENDING`, `SUBSCRIPTION_NOT_STARTED`, `PLAN_FEATURE_MISSING`. |
| R4 | `POST /auth/resend-otp` | **Done** (§5.2): 1 per minute, 5 per hour. |
| R5 | `plan.features[]` in `GET /subscriptions/current` | **Done** (§6): same shape as `/subscriptions/plans`. |
| R6 | Razorpay order + signature verify | **Open**: waits for the Razorpay account (pre-production checklist 1.1–1.5). |
| R7 | `status` (`ACTIVE` / `INACTIVE`) in the agent object | **Done** (§9). Inactive agents are now also listed in `GET /agents` / `GET /agents/:id` for their owner, so they can be reactivated. |
| R8 | Per-PC numbers in the machine list and detail | **Done** (§12): a new `pc` block per machine; the existing fields stay the CSP unit's. |
| R9 | `amount: null` for receipts without an amount | **Done** (§13). |
| R10 | Commission per service | **Done**: see R12 (§13B; rev 25 adds `SLAB` rates and the dashboard `commission` today / month). |
| R11 | CSP-only dashboard view | **Done** (§11): `includeKos=false`. |

The app team's list, as they wrote it (found while building the app against this KT; ordered by priority; the app has a workaround for each until it's done):

| # | Requirement | Why the app needs it | App workaround today |
|---|---|---|---|
| R1 | **Fix the 2-decimal money check.** `core/validators/common.validator.ts:70` uses `Math.round(amount * 100) === amount * 100`, which fails for many valid amounts because of floating point (e.g. `0.07`, `0.29`, `1000.29`: about 9% of 2-decimal values up to ₹1000). Use the tolerant check already in `cash.validation.ts:69`: `Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6`. | Signup cash fields and every money field using the common validator reject valid input with "can have at most 2 decimal places." | The app validates decimals on the typed text, but the server still rejects those values. **Bug, fix first.** |
| R2 | **`POST /auth/refresh`** (§5.2). | The access token lasts 15 min; users are sent back to Login every 15 min, including in the middle of a checkout. | Logout on 401 / expired `exp`, Login prefilled. |
| R3 | **Stable `code` on 403/409 answers the app branches on.** Today they all come back `FORBIDDEN` / `CONFLICT`, so the app matches the message text, which breaks if a message is reworded. Suggested codes: `ACCOUNT_NOT_VERIFIED` ("Please verify your account first."), `ACCOUNT_EXISTS` (signup 409), `OTP_INVALID`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED`, `OTP_NOT_FOUND`, `SUBSCRIPTION_NONE`, `SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_SUSPENDED`, `SUBSCRIPTION_CANCELLED`, `SUBSCRIPTION_PENDING`, `SUBSCRIPTION_NOT_STARTED`, `PLAN_FEATURE_MISSING` ("Your subscription does not include this feature."). | Paywall, upgrade prompt, OTP and "verify first" flows. | Exact message match (§7 list). |
| R4 | **`POST /auth/resend-otp`** (§5.2). | Resending a code needs the whole signup again, including the password, which the app keeps only in memory. After an app restart the user must fill the signup form again. | "Send a new code" re-posts signup; after a restart it offers "Sign up again". |
| R5 | **`plan.features[]` in `GET /subscriptions/current`** (same shape as in `/subscriptions/plans`). | Feature gating needs a second call to the public plans list and a lookup by plan id; a plan that was deactivated after purchase isn't in that list, so its features are lost. | Two calls; falls back to "no extra features" when the plan isn't listed. |
| R6 | **Razorpay order + signature verify** (checklist 1.1–1.5). | Checkout is manual: `verify` accepts any `gatewayTransactionId`. | Checkout is wrapped in one `payForPlan()` function; manual flow only in dev builds. |
| R7 | **Return `status` (`ACTIVE` / `INACTIVE`) in the agent object** (`agent.mapper.ts`). | `PATCH /agents/:agentId` can set it, but no response includes it, so the app can't show an inactive KO or offer to reactivate one. | Not shown. |
| R8 | **Per-PC numbers in `GET /machines/list` and `GET /machines/:id`.** Both report the CSP *unit*: a CSP's PC counts the CSP's and all its KOs' transactions, and a KO's PC detail shows the parent CSP as `agent` and the unit's online status. | The Machines tab is per PC (canvas): it would show a CSP's PC with its KOs' transactions. | The app reads the matching entry in `children` (the PC's own agent), and `/heartbeat` for the live status. |
| R9 | **`amount: null` for receipts without an amount** (`receipt.mapper.ts` sends `Number(amount ?? 0)`; KT §13 says `null`). | ₹0 and "no amount" look the same. | The app shows "—" for non-cash categories. |
| R10 | **Commission per service**, set by the super admin (balance enquiry, withdrawal, deposit, money transfer, passbook, …), with the earned amount in the dashboard / reports. | The canvas KO and CSP views show "Commission ≈" for the period. No commission exists in the backend yet. | Not shown. |
| R11 | **A CSP-only view in `/dashboard/summary`** (e.g. `agentId=<CSP>&includeKos=false`). `agentId=<CSP>` always adds its KOs. | "Your own view" for the CSP can't show just the CSP's own counter. | The CSP's own view says it includes its KOs. |

### 19.2 Endpoints the v2 app screens need

**Backend status (rev 23, 2026-11-04):**

| # | Endpoint(s) | Status |
|---|---|---|
| R12 | Commission | **Done** (§13B, rev 24). Decided: **only the CSP earns** (KOs are salaried by the CSP), **by month**; FLAT / PERCENT rates per service set by the super admin (default, BC or CSP override), frozen per receipt. Differences from your draft: `month=` added; `byAgent` = where it was generated; `GET /commission/months` added; no `SLAB` rates yet; rates have no DRAFT state (a future `effectiveFrom` is the draft). |
| R13 | Team today | **Done** (§13C, rev 24). Online = heartbeat sessions with at most one missed heartbeat; active = SBI work (activity start → stop); late / early against the CSP's `workdayStart` / `workdayEnd` (`/team/settings`). Adds `onlineSeconds` next to `activeSeconds`, `earlyLeaveMinutes`, `status`. |
| R14 | Requests inbox | **Future scope** (not planned now; §19.3). Use §13A requests and the settlements feed. |
| R15 | Receipt detail fields | **Done** (§13, rev 24 + rev 25): **no Aadhaar** — remove `customerAadhaarMasked` from the app. The super admin decides which optional fields the desktop may send (`bankName`, `balanceAfter`, `bankTransactionId` (your `transactionId`), `bankResponseCode`, `bankResponseMessage`, `customerName`, `customerAccount`, `rrn`, `stan`, `terminalId`, `location`); the detail returns them (`null` when not sent). Rev 25: `rrn` and `location` are fixed defaults; `stan`, `terminalId` and the rest are extras the super admin selects. Slip image, PDF and "report a problem" **built** (§13): your `slipAvailable` is **`hasSlip`**; `GET …/slip` returns a 5-minute link; `GET …/pdf`; `POST …/report { reason, details? }`; `GET /receipts/reports`. |
| R16 | `?agentId=` on `GET /receipts/:receiptId` | **Done** (§13). |
| R17 | `GET /cash-management/dues/:dueId` with `events` | **Done** (§13A); the desktop has `GET /machines/runtime/cash/dues/:dueId` too. |
| R18 | `ownSubscription` on a BC's CSPs | **Done** (§9). |
| R19 | Stable social-security metric codes in `cspSummary.socialSecurity` | **Confirmed**: `PMJJBY`, `PMSBY`, `APY`, … are seeded codes and won't change. |

The app team's proposals, as they wrote them:

The design canvas ("CSP v2 · commission, receipts, requests" and "KT draft · backend & admin") adds screens that need new endpoints. The app already calls the ones below; until they exist it gets **404** and hides that part of the screen (no error shown). Shapes follow §3: `{ success, message, data }`, money in rupees (numbers, 2 decimals), dates ISO-8601, day boundaries IST. Every endpoint is scoped like §4B (CSP: itself + its KOs; BC: its CSPs + KOs) and needs an active subscription (§7).

#### R12 · Commission (Home hero, Commission screen, Receipts, KO detail)

**Status: done** (§13B): only the CSP earns, by month.

Admin sets rates per service; the app shows an **approximate** commission from successful receipts. Rates are frozen on each receipt when it's saved (past days are never recalculated); failed / reversed receipts earn 0.

**Data model (backend):** `services` (`id, code, name, transactionCategory, group: FINANCIAL | NON_FINANCIAL | ENROLMENT, sortOrder, isActive`); `commission_rate_cards` (`id, scope: DEFAULT | BC | CSP, scopeId, name`); `commission_rates` (`cardId, serviceId, type: FLAT | PERCENT | SLAB, amount, percent, min, max, slabs json, appliesToKo, effectiveFrom, effectiveTo, status: DRAFT | LIVE | ENDED, createdBy, reason`; one LIVE rate per card + service at a time); receipts add `serviceId, commissionRateId, commissionAmount`. Card precedence: CSP override > BC override > DEFAULT.

`GET /commission/summary?period=TODAY|WEEK|MONTH&agentId=`

- `agentId` optional, same rule as `/dashboard/summary` (a CSP = CSP + KOs; a KO = that KO). `WEEK` = Monday → today, `MONTH` = 1st → today (IST).

```json
"data": {
  "period": "TODAY", "from": "2026-11-03", "to": "2026-11-03",
  "total": 615, "previousTotal": 543, "monthToDate": 1840,
  "successCount": 50, "excludedFailedCount": 2,
  "groups": { "FINANCIAL": 516, "NON_FINANCIAL": 13, "ENROLMENT": 86 },
  "rows": [
    { "serviceCode": "CW", "serviceName": "Cash withdrawal", "transactionCategory": "CASH_WITHDRAWAL", "group": "FINANCIAL",
      "count": 14, "rateType": "FLAT", "rate": 15, "rateLabel": "₹15", "amount": 210 }
  ],
  "byAgent": [ { "agentId": "CSP-001", "name": "Ravi Kumar", "amount": 252 } ],
  "updatedAt": "2026-11-03T13:12:00.000Z"
}
```

`rows` lists **every active service** (count 0 / amount 0 included, ordered by `sortOrder`); `previousTotal` is the same period one step back (yesterday / last week / last month to the same day).

`GET /commission/rates` → the live rates for this CSP (or BC):

```json
"data": { "effectiveFrom": "2026-11-01T00:00:00+05:30",
  "rates": [ { "serviceCode": "CW", "serviceName": "Cash withdrawal", "transactionCategory": "CASH_WITHDRAWAL",
               "rateType": "FLAT", "rateLabel": "₹15", "unit": "TRANSACTION" } ] }
```

`unit`: `TRANSACTION` | `ENROLMENT`. Admin side (super admin console, not the app): `GET/POST /admin/rate-cards`, `PUT /admin/rates/:id` (saves DRAFT, goes LIVE at `effectiveFrom`, which must be in the future), `GET /admin/rates/history`, CRUD `/admin/services`, CRUD `/admin/social-security-schemes`; every write to `audit_log`.

Also add `commissionAmount` to `GET /receipts/stats` (same filters) and `commission: { amount, rateLabel } | null` to `GET /receipts/:receiptId`.

#### R13 · Team today (Home "Team today": first login, active hours, late login)

**Status: done** (§13C).

**Data model:** `agent_sessions` (`agentId, machineId, date (IST), firstLoginAt, lastSeenAt, activeSeconds, status`), built from heartbeats + SBI login events; a gap > 5 min stops the active timer. CSP setting `workdayStart` ("09:30", nullable).

`GET /team/today?agentId=`

```json
"data": {
  "date": "2026-11-03", "startTime": "09:30",
  "members": [
    { "agentId": "KO-0014", "name": "Asha Mehra", "type": "KO", "machineName": "Village kiosk",
      "online": false, "firstLoginAt": "2026-11-03T04:45:00.000Z", "lastSeenAt": "2026-11-03T10:50:00.000Z",
      "activeSeconds": 21900, "lateMinutes": 45 }
  ]
}
```

`lateMinutes` = minutes after `startTime` of the first login (0 when on time or no `startTime`). Optional: `PATCH /team/settings { workdayStart: "09:30" | null }` (CSP).

#### R14 · Requests inbox (Home bell, Requests screen)

**Status: future scope** (§19.3).

One feed of everything waiting for the CSP: KO cash requests (§13A), KO settlements to confirm, a BC asking to link this CSP, a KO asking for another PC.

**Data model:** `requests` (`id, type: CASH | SETTLEMENT | BC_LINK | NEW_MACHINE, fromAgentId, toCspAgentId, payload json, status: PENDING | APPROVED | DECLINED | EXPIRED, actedBy, actedAt`).

`GET /requests?status=PENDING|DONE_TODAY&page=&limit=` → `data: { items, pagination }`, item:

```json
{ "id": "req_…", "type": "CASH", "status": "PENDING",
  "title": "Suresh needs ₹20,000 cash",
  "body": "KO-0012 · Market branch · cash in hand ₹32,000 · pool after: ₹25,000 in account",
  "fromAgentId": "KO-0012", "fromName": "Suresh Patel", "createdAt": "…",
  "approveLabel": "Approve", "declineLabel": "Decline", "payload": { } }
```

`POST /requests/:id/approve` and `POST /requests/:id/decline` (body optional `{ remarks }`), header `Idempotency-Key` (same rules as §13A). Approving `CASH` writes to the cash ledger in the same DB transaction; approving `BC_LINK` links the CSP (the CSP consents, then the admin approves as in §10); `NEW_MACHINE` approve opens checkout in the app (no server change). Response: the updated request. Errors: 409 `This request has already been handled.`, 404 `Request not found.`. Until this exists the app shows §13A KO cash requests (approve/reject via `/cash-management/requests/:id/review`) and open settlements.

#### R15 · Receipt detail fields (Receipt screen)

**Status: partly done** (§13): no Aadhaar field (remove it from the app); optional fields allowed by the super admin; slip / PDF / report are future scope (§19.3).

Add to `GET /receipts/:receiptId`: `bankName`, `customerAadhaarMasked` (`"XXXX XXXX 4821"`), `balanceAfter` (number | null), `transactionId`, `bankResponseCode`, `bankResponseMessage`, `slipAvailable` (boolean). New:

- `GET /receipts/:receiptId/slip?agentId=` → `{ url }` signed image URL (5 min) of the original bank slip captured by the watcher.
- `GET /receipts/:receiptId/pdf?agentId=` → `application/pdf` (like §17).
- `POST /receipts/:receiptId/report?agentId=` `{ reason }` → 201 `Thanks, we'll look into it.`

#### R16 · `agentId` on single-receipt calls

**Status: done** (§13).

`receiptId` is unique **per agent** (§13), but `GET /receipts/:receiptId` takes no agent, so two KOs with the same receipt number can't be told apart. Accept `?agentId=` on `GET /receipts/:receiptId` (and R15's calls) and use it when given.

#### R17 · Balance due history (Due detail "History")

**Status: done** (§13A).

`GET /cash-management/dues/:dueId` → the due plus `events: [ { type: "CREATED" | "PART_SETTLED" | "SETTLED" | "CANCELLED", amount, cashSide, machineCode, createdAt } ]`. Until then the app shows recorded → (collected so far) → still due from the list fields.

#### R18 · Own-plan status of a BC's CSPs (BC "CSPs" list)

**Status: done** (§9).

The canvas shows "Own plan active" / "No own plan yet" per CSP. Add `ownSubscription: { status, endDate } | null` to agents returned to a BC (`GET /agents?type=CSP`).

#### R19 · BC summary tabs

**Status: confirmed**: the codes are seeded and stable.

`/dashboard/summary` already returns `cspSummary.transactions` and `cspSummary.socialSecurity`; the BC Home tabs use them. Keep the social-security metric `code`s stable (`PMJJBY`, `PMSBY`, `APY`, …): the app matches on them.

### 19.3 Future scope (agreed, not planned yet)

| Item | Notes |
|---|---|
| Requests inbox (R14): one feed of what waits for the CSP, with approve / decline | Today: §13A KO cash requests (`/cash-management/requests`) and the settlements feed. A BC asking the CSP to link, and a KO asking for another PC, would be new flows. |
| Push notifications | Checklist 2.14 / 2.16 (link approvals, revoke results, settlements, CSP tasks, problem report answered). |

Built in rev 25 (were future scope): receipt slip / PDF / report a problem (§13), commission slabs (§13B), forgot / reset / change password (§5.2).

## 20. Changelog

- 2026-11-07 (rev 27) — Owner decisions: blocked during renewal retries (`state` / 403 `RENEWAL_PENDING`, §6A.4, §7.2; purchase meanwhile → 409 `RENEWAL_IN_PROGRESS`); a plan price change replaces running mandates at the new price (`MANDATE_REPLACED` notification, mandate status `REPLACED`, §6A.3); a purchase after a cancel starts now (confirmed); CSP plans have no grace period (`graceEndsAt` always null).
- 2026-11-07 (rev 26) — **Read §0.** Plans: ₹450 `CSP_AUTOMATION_CASH_MANAGEMENT` removed (₹250 automation / ₹550 complete). New `GET /subscriptions/access` and plan blocking (§7: non-closable "Please renew or take a new plan." / "Please upgrade the plan."; server 403 `SUBSCRIPTION_REQUIRED` / `PLAN_UPGRADE_REQUIRED` on dashboard, team, machines, receipts, reports, commission, cash for CSPs). §6A: CSP upgrade only (difference only, first 12 days, end date unchanged; `POST /subscriptions/quote`; payment `purpose`), no downgrade / fewer machines, UPI mandate with monthly auto renewal at the end date/time (2 retries 15 min apart, then stop at once: `LAPSED`), `POST /subscriptions/current/cancel` (no refund, works till end date, mandate cancelled). §8: one activation per agent (`AGENT_ALREADY_HAS_ACTIVATION`). §5.1 / §9: no CSP limit input (worked out); KO creation moves cash in hand from the CSP / edited agents (`cashAdjustments`), the rest raises the limit; `POST /agents/:id/replace`; delete removes the KO's cash; KO email (`emailVerifiedAt`) for shared PCs; KO management works without a running plan. §13A: derived limit, no limit check, `INCREASE` / `DECREASE`, Adjust requests (`GET /cash-management/adjustments`, `machineActive`, `pendingAdjustments`, `balanceDue`), activation difference (cash in account / other) with CSP notification; new ledger types. New §13D notifications.

- 2026-11-04 (rev 25) — §5.2: forgot / reset / change password; blocking cuts access at once (403 `ACCOUNT_BLOCKED` / `ACCOUNT_SUSPENDED` with a reason on any call; 401 `SESSION_ENDED` after a password change elsewhere); OTP attempts now really count. §6: **price + GST** (`gstPercent`, `gstAmount`, `priceWithGst` on plans; `taxPercent`, `taxAmount`, `totalAmount`, `invoiceNumber` on payments), grace period (`graceEndsAt`, set by the super admin), no credit on upgrade. §11: dashboard `commission` (today + month). §13: fixed default receipt fields (`rrn`, `location`; `stan` and `terminalId` are now optional, off until the super admin selects them) + super-admin-selected extras (`fixed` in `/receipts/fields`), receipt **slip** (`hasSlip`, `GET …/slip`), **PDF** (`GET …/pdf`), **report a problem** (`POST …/report`, `GET /receipts/reports`). §13A: a BC sees only the cash limit and its distribution (other cash hidden; other cash endpoints 403). §13B: `SLAB` rates (`slabs`).

- 2026-11-04 (rev 24, update) — §13: receipt detail `fields` (only what the receipt has, with labels: build the screen from it), `GET /receipts/fields`; receipts can carry more or fewer optional fields as the super admin changes them.
- 2026-11-04 (rev 24) — New §13B commission (only the CSP earns, by month; `/commission/summary`, `/months`, `/rates`; commission on receipt detail and stats) and §13C team today (`/team/today`, `/team/settings`). §13: optional receipt fields set by the super admin; **no Aadhaar** (remove `customerAadhaarMasked`). §12: a PC is online while its last heartbeat is ≤ 120 s old (at most one missed). §19.2 statuses; §19.3 future scope (requests inbox, slip / PDF / report, slabs).

- 2026-11-04 (rev 23) — Backend answers to §19.1 / §19.2 (status tables). Built: money 2-decimal fix (R1); `POST /auth/refresh` with rotation, `POST /auth/logout` (R2, §5.2–5.3); `code`s for login / OTP / subscription errors (R3, §3); `POST /auth/resend-otp` (R4); `plan.features` in the current subscription (R5); agent `status` and inactive agents in the owner's list (R7); per-PC `pc` block in machines (R8, §12); `amount: null` (R9); `includeKos=false` (R11); `?agentId=` on the receipt detail (R16); due history `GET /cash-management/dues/:dueId` (R17); `ownSubscription` for a BC's CSPs (R18). The receipt detail now needs an active subscription like the list.

- 2026-11-03 (rev 22) — New §19.2 (R12–R19): endpoints for the v2 app screens with request and response: commission summary and rates, team today, requests inbox with approve/decline, receipt detail fields + slip/PDF/report, `agentId` on single-receipt calls, due history, CSP own-plan status for BCs, BC summary metric codes.
- 2026-11-03 (rev 21) — New §19.1: backend requirements found while building the app (money 2-decimal check bug, refresh token, stable codes for subscription/OTP/verify errors, resend OTP, plan features in the current subscription, Razorpay, agent `status`, per-PC machine numbers, `null` receipt amounts, commission, CSP-only dashboard view).

- 2026-11-03 (rev 20) — New §4B: every app API by role (CSP / BC columns, the subscription or plan each needs, body → answer, section), and what each tab calls in order.

- 2026-11-03 (rev 19) — `POST /agents/csp` only for BCs on a machine plan (₹199 / ₹399); the ₹799 plan only links (403 `PLAN_LINK_ONLY`). A BC-created CSP needs its own subscription for the app (§4A.5).
- 2026-11-03 (rev 18) — New §4A: the full app flow by role (every launch, what each plan unlocks, CSP and BC journeys step by step with their calls, a CSP created by a BC, build order). §3: errors carry `code`.

- 2026-11-03 (rev 17) — §13A: balance dues can be put on cash in hand / cash in account (they move against each other) or extra cash (with the new `cashDueExtra`, part of the rule); `cashSide` on dues; default labels for new pools; settlement request fields; ledger `cashDueExtraChange`. Every error answer now has a stable `code` next to `message` (e.g. `PLAN_NO_CASH_MANAGEMENT`, `VALIDATION_FAILED`, `RATE_LIMITED`); switch to it.

- 2026-11-03 (rev 16) — §13A: other cash (`cashOther`, rule = limit + other cash; ADJUSTMENT `cashOther`); labels (`/cash-management/labels`), balance due (`/dues`), day closes (`/day-closes`) and tasks (`/tasks`) for the KOs' desktop cash extras; setup without `cashInAccount` takes the agents' saved activation counts into account; new ledger types `CUSTOM`, `DUE_*`, `EXCHANGE`, `DAY_CLOSE`.

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
