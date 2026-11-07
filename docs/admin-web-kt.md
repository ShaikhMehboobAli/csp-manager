# CSP Manager Super Admin Console (React / Next.js) — KT

**Audience:** the web team building the **Super Admin** console in React / Next.js.
**Not covered here:** the BC/CSP mobile app → `docs/mobile-app-kt.md` (read its sections 3 and 18 for API conventions, errors and dates; they apply here too); the desktop app → `docs/desktop-integration-changes.md`.
**Backend source of truth:** `csp-manager/apps/api`.
**Last updated:** 2026-11-04 (rev 17)

> Describes the backend once PRs #3–#8 are merged into `development`.

---

## 1. What the Super Admin does

| Area | Status |
|---|---|
| Review BC↔CSP link requests (approve / reject, conflicts) — approving links the CSP **and its KOs** | READY |
| Set plan prices and billing cycles | READY |
| Manage metric definitions (social-security and other metrics) | READY |
| Browse and edit agents (BCs, CSPs, KOs) | READY |
| Global dashboards, machines, transactions, reports (all agents) | READY |
| Manage users, subscriptions, payments | not available (gap G3) |

## 2. Recommended stack

| Concern | Recommendation |
|---|---|
| Framework | Next.js 14+/15 App Router, TypeScript |
| Auth | **BFF pattern**: a Next.js route handler (`/api/session`) calls `POST /api/v1/auth/login` and stores the access token in an **httpOnly, Secure, SameSite=Strict cookie**. Never put tokens in `localStorage`. |
| API calls | server components / route handlers read the cookie and call the API with `Authorization: Bearer`; client components go through `/api/proxy/*` or server actions |
| Guard | `middleware.ts`: no cookie → `/login`; JWT `role !== "SUPER_ADMIN"` → `/forbidden` (decode the payload only for routing; the API re-checks the role on every call) |
| Data | TanStack Query on the client (lists, mutations, invalidation) |
| UI | shadcn/ui (or MUI) + TanStack Table for server-paginated tables |
| Forms | react-hook-form + zod, mirroring the rules below |

Env: `API_BASE_URL` (server-side only; HTTPS in production).

## 3. Auth and session

- **Login:** `POST /auth/login { agentId, password }` → `data.user.role` must be `SUPER_ADMIN`. Errors as in the mobile KT §5.
- **No super admin signup:** signup only creates BC/CSP accounts. The backend creates the super admin with `npm run seed:super-admin` (env `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` ≥ 12 chars, optional `SUPER_ADMIN_AGENT_ID`, default `SUPERADMIN`). The dev account is `SUPERADMIN`; ask the backend owner for its password. The admin's own agent record has type `ADMIN` and is never listed.
- **No subscription needed:** the super admin isn't gated by a subscription. (Other owners' subscriptions are still checked, e.g. approving a ₹799 request still requires the BC's plan to be active.)
- **Token lifetime:** 15 minutes, no refresh endpoint (gap G4). On a 401 from the API, clear the cookie and redirect to `/login?expired=1`.
- **Scope:** a super admin's scope is **everything**. List endpoints return all agents' data; narrow with `agentId` / `bcId` filters.

## 4. BC link requests (review)

The BC ₹799 flow (mobile KT §10): a BC requests to link a CSP, and only the **Super Admin** can approve it. A request also arrives when a machine-plan BC adds an existing CSP via `POST /agents/csp`.

### 4.1 List

`GET /bc-links/requests?status=PENDING|APPROVED|REJECTED|CANCELLED&isConflict=true|false&bcId=&cspAgentId=&page=&limit=` (`limit` ≤ 100, default 20)

→ `data: { items: LinkRequest[], pagination: { page, limit, total, totalPages } }`, newest first.

```json
{
  "id": "…", "requestNumber": "LNK-2026-000002", "status": "PENDING",
  "bcId": "BC1001", "bcName": "…", "cspAgentId": "CSP-001", "cspName": "…",
  "isConflict": true, "linkType": "SUBSCRIBED_CSP",
  "currentBcId": "BC0001", "cspCurrentBcId": "BC0001",
  "remarks": "from the BC", "reviewRemarks": null, "reviewedAt": null,
  "createdAt": "…", "updatedAt": "…"
}
```

| Field | Meaning |
|---|---|
| `isConflict` | the CSP was linked to another BC when the request was raised (or became so while pending) |
| `currentBcId` | the BC the CSP belonged to at request time (or the BC it was moved from, after approval) |
| `cspCurrentBcId` | the BC the CSP belongs to **right now** |
| `linkType` | `SUBSCRIBED_CSP` (₹799 BC: the BC sees the CSP's data only while the CSP's own plan is active; view-only for the BC) or `BC_MANAGED` (machine-plan BC: always visible, BC may edit) |

### 4.2 Detail, approve, reject

| Call | Body | Success |
|---|---|---|
| `GET /bc-links/requests/:id` | — | link request |
| `POST /bc-links/requests/:id/approve` | `{ "remarks"?: string ≤ 500 }` (body optional) | `Link request approved. The CSP and its N KO(s) are now linked to the BC.` (or `…The CSP is now linked to the BC.` without KOs); `data` = link request + **`linkedKoAgentIds: string[]`** |
| `POST /bc-links/requests/:id/reject` | `{ "remarks"?: string ≤ 500 }` | `Link request rejected.` |

**What approve does (one transaction):**
1. Links the CSP to the requesting BC (`bcId`, `linkedAt`), and **all of the CSP's KOs** with it.
2. If the CSP belonged to another BC, it **moves**: the previous BC loses its data immediately, and the request records `isConflict: true` and `currentBcId` = the previous BC.
3. Other pending requests for the same CSP are flagged `isConflict: true`.

Errors: 409 `This request has already been reviewed.`; 400 `The CSP is no longer active.`; 400 `The BC does not have an active CSP linking plan.` (`SUBSCRIBED_CSP` only: the BC's ₹799 plan ended); 404 `Link request not found.`

### 4.3 UI

- Tabs: **Pending** (default), **Conflicts** (`status=PENDING&isConflict=true`), **History** (approved/rejected/cancelled). Badge counts from `pagination.total`.
- Table: request no., BC (id + name), CSP (id + name), link type, conflict chip, created, actions.
- Detail drawer: all fields, the BC's remarks, plus the CSP's agent record and KOs (`GET /agents/:cspAgentId`, `GET /agents?parentAgentId=:cspAgentId&type=KO`) so the admin sees which KOs will move.
- **Conflict approval:** red banner "CSP is linked to `cspCurrentBcId`. Approving moves the CSP and its KOs to `bcId`; `cspCurrentBcId` loses access." Require remarks, and a confirm dialog typing the CSP id.
- After approve/reject: invalidate the list queries; toast the message (it includes the KO count).

## 4A. Activation revoke requests (review) — READY

A CSP or BC can't revoke an activation themselves: they raise a **revoke request** from the mobile app, and only the super admin approves or rejects it. Until approval the activation keeps working.

| Call | Notes |
|---|---|
| `GET /activations/revoke-requests?status=PENDING&ownerId=&activationId=&page=1&limit=20` | all owners' requests (filter by `ownerId` = the CSP/BC agent id) |
| `GET /activations/revoke-requests/:requestId` | one request |
| `POST /activations/revoke-requests/:requestId/approve` `{ remarks? }` | revokes now: the PC (`machineCode`) stops working at once, the code goes back to unused and unassigned with the same expiry. Response: the request (`APPROVED`) plus `revoked { activationId, activationCode, status, expiresAt, releasedMachineCode }` |
| `POST /activations/revoke-requests/:requestId/reject` `{ remarks? }` | `REJECTED`, activation unchanged. Put the reason in `remarks`; the owner sees it as `reviewRemarks` |
| `POST /activations/:activationId/revoke` | direct revoke without a request (support cases) |

Request: `{ id, requestNumber (RVK-…), status, activationId, activationCode, activationStatus, assignedAgentId, ownerType (CSP|BC), ownerId, machineCode, currentMachine { machineCode, machineName } | null, reason, reviewRemarks, reviewedAt, createdAt, updatedAt }`.

Errors: 409 `This request has already been reviewed.` (another admin was faster, or it was cancelled); 400 `Only an activation that is in use or assigned can be revoked.` on approve when the activation changed since the request (reject it instead); 404 `Revoke request not found.`

**UI:** a "Revoke requests" queue next to link requests (Pending first, badge count), showing owner, activation code, machine, how long the machine has been online (`/machines/:id` → `lastHeartbeatAt`) and the owner's reason. Approve asks for confirmation: "PC `<machineCode>` will stop working immediately." Poll the pending list every 60 s until push notifications exist (pre-production checklist 2.14).

## 5. Plans and pricing

| Call | Notes |
|---|---|
| `GET /subscriptions/plans?ownerType=BC\|CSP` | public; **only active** plans and billing cycles |
| `PATCH /subscriptions/plans/:planId/pricing` | SUPER_ADMIN |

```json
{ "billingCycle": "HALF_YEARLY", "price": 4794, "durationDays": 180, "isActive": true }
```

| Field | Rule |
|---|---|
| `billingCycle` | `MONTHLY` \| `QUARTERLY` \| `HALF_YEARLY` \| `YEARLY` |
| `price` | number, > 0, ≤ 1,000,000 |
| `durationDays` | integer 1–3660; **required only when adding a cycle the plan doesn't have** (`durationDays is required for a new billing cycle.`) |
| `isActive` | optional; `false` hides the cycle from plans and checkout |

→ `data: { planId, planCode, billingCycle, durationDays, price (string), isActive }`. Errors: 404 `Plan not found.`, 400 validation, 403 for non-admins.

Rules: new prices apply to new purchases and renewals; running subscriptions keep what they paid. The seed script never overwrites prices set here. ₹799 BC plan (`BC_CSP_LINK`) defaults: 799 / 4794 / 9588 (monthly / half-yearly / yearly = 799 × months).

**UI:** a page per owner type; one card per plan (code, name, machine limit, features) with an editable row per cycle (price, duration, active toggle, Save). "Add billing cycle" asks for cycle, price and duration. The plan list returns only active cycles, so an inactive cycle disappears after a refetch: keep it in local state for the session, and show "inactive cycles are hidden".

## 6. Metric definitions

| Call | Body / query | Notes |
|---|---|---|
| `GET /metrics?category=&source=&isActive=` | | list |
| `GET /metrics/:metricId` | | detail |
| `POST /metrics` | `{ code, name, category, source, inputType?, description? }` | SUPER_ADMIN |
| `PATCH /metrics/:metricId` | `{ name?, category?, source?, inputType?, description? }` | SUPER_ADMIN (code can't change) |
| `PATCH /metrics/:metricId/status` | `{ isActive: boolean }` | SUPER_ADMIN |

Rules: `code` 2–50 chars, `^[A-Z0-9_]+$` (`Code must contain only uppercase letters, numbers, and underscores.`); `name` 2–100; `category` `SOCIAL_SECURITY|TRANSACTION|VISIT|MANUAL|OTHER`; `source` `RECEIPT` (counted from uploaded transactions, matched by `code` to a receipt type/category) or `MANUAL` (BCs enter daily values in the mobile app); `inputType` `COUNT|NUMBER|BOOLEAN`; `description` ≤ 500.

UI: table with an active toggle; a create/edit form. Warn before deactivating ("BCs can no longer enter values; dashboards stop showing it").

## 7. Agents directory

| Call | Status for Super Admin |
|---|---|
| `GET /agents?type=BC\|CSP\|KO&bcId=&parentAgentId=&page=&limit=` | works (all agents) |
| `GET /agents/:agentId` | works |
| `PATCH /agents/:agentId`, `DELETE /agents/:agentId` | works (any agent; delete KOs before their CSP) |
| `POST /agents/csp` | don't use from the console (gap G5) |

Agent: `{ id, agentId, name, type, mobile, email, address, bcId, parentAgentId, cashLimit, openingCash, linkedAt, createdAt, updatedAt }`. Build the BC → CSP → KO tree with `bcId` and `parentAgentId` filters.

## 8. Global data views — READY

Same endpoints and shapes as the mobile KT §11–§14; for the super admin they cover **all agents**. Narrow with `agentId`: a CSP means the CSP + its KOs, a KO only itself. Receipts take several `agentIds`, `receiptTypes` and `transactionCategories`, plus `period` (mobile KT §13):

`GET /dashboard/summary` (multi-agent view: `machineMonitoring` across all machines), `/dashboard/analytics`, `/dashboard/csp/:agentId/detail`, `/machines/list`, `/machines/:id`, `/machines/:id/analytics`, `/machines/:id/activity-sessions`, `/receipts`, `/receipts/:receiptId`, `/receipts/stats`, `/receipts/export`, `/reports/summary` (one row per CSP), `/reports/export`.

- Day boundaries are IST (mobile KT §18).
- `GET /activations` returns only the caller's **own** activations (none for an admin); there's no admin-wide activation list yet (G3).
- **Cash management (read-only for the admin):** `GET /cash-management?agentId=<CSP or KO>`, `GET /cash-management/ledger?agentId=…`, `GET /cash-management/requests?agentId=…`, `GET /cash-management/settlements?agentId=…` (KO settlements), and read-only `GET /cash-management/labels|dues|day-closes|tasks?agentId=…` (mobile KT §13A). Pool views have `cashOther` (net cash from custom transactions and dues). `agentId` is required for the admin; settling, adjusting and approving are the CSP's (403 for the admin).
- **Retention:** receipts are kept for 60 days, per-day counts for 1 year. Counts and amounts (dashboards, analytics day and longer, reports, machine stats, `/receipts/stats` without `search`) cover a year; the transaction list/detail/export, `recentTransactions` and hourly charts cover the last 60 days (mobile KT §11, §13).

## 9. Desktop settings and machine controls — READY

Super admin only (others get 403). The desktop reads the result on every heartbeat (60 s) and before every service start, so a change reaches the PCs within about a minute.

| Call | Body / notes |
|---|---|
| `GET /admin/desktop-settings` | current global settings |
| `PATCH /admin/desktop-settings` | any of the fields below; omitted fields keep their value, `null` clears a version/URL |
| `GET /admin/machines/:machineCode/desktop-controls` | `{ machineCode, override, effective }` |
| `PATCH /admin/machines/:machineCode/desktop-controls` | `{ "desktopControls": { services?, receiptCashDenominationConfirm? } }`, or `{ "desktopControls": null }` to remove the override |
| `POST /activations/:activationId/revoke` | revoke **any** activation directly, without an owner request (§4A); it also closes an open request for it as approved |

Global settings body (all optional):

```json
{
  "services": { "CASH_WITHDRAWAL": false, "PASSBOOK_PRINTING": true },
  "receiptCashDenominationConfirm": true,
  "minimumVersion": "1.0.0",
  "latestWatcherVersion": "1.2.0",
  "downloadUrl": "https://…/CSPManagerSetup.exe",
  "portalUrl": null
}
```

- **Service codes** (only these are accepted; anything else → 400): `BALANCE_ENQUIRY`, `MINI_STATEMENT`, `CASH_WITHDRAWAL`, `CASH_DEPOSIT`, `MONEY_TRANSFER`, `PASSBOOK_PRINTING` (automated today), `FUND_TRANSFER`, `TRANSACTION_HISTORY`, `KYC_UPDATION`, `ACCOUNT_OPENING`, `AADHAAR_SEEDING`, `AEPS_REGISTRATION` (not automated yet).
- **How switches combine:** a service is off on a machine when the **global** switch **or** that machine's override turns it off. Use the global switch for maintenance (all machines); a machine override can only turn things off further, not back on.
- `receiptCashDenominationConfirm = false` hides the desktop popup where the operator confirms the cash counts after printing; the counts entered before the transaction are still required.
- Versions are `1.0.0`-style. Below `minimumVersion` the desktop blocks automation and offers `downloadUrl`. `portalUrl` is the subscription page for the desktop's "Renew" button; leave it `null` until the web portal exists.
- The PATCH response returns the full stored settings; `GET …/desktop-controls` returns `effective`, all 12 codes as the PC sees them.

**UI:** a "Desktop" settings page with one toggle per service (a banner while any is off: "Maintenance: Cash Withdrawal is off on all machines"), the popup toggle, and the version fields. On a machine's detail page, an "Overrides" panel with the same toggles and a "Clear overrides" button.

## 9A. Receipt retention — READY

How long the server keeps individual receipts. Per-day counts are kept for 365 days whatever this is set to, so dashboards and reports aren't affected (§8).

| Call | Body / notes |
|---|---|
| `GET /admin/receipt-retention` | current setting and the last cleanup run |
| `PATCH /admin/receipt-retention` | `{ "receiptRetentionDays": 30 }` |

`GET` / `PATCH` → `data`:

```json
{
  "receiptRetentionDays": 30,
  "minimumDays": 15,
  "maximumDays": 365,
  "countRetentionDays": 365,
  "receiptsDeletedBefore": "2026-09-30T18:30:00.000Z",
  "uploadCutoff": "2026-10-01T18:30:00.000Z",
  "lastRun": { "status": "SUCCESS", "startedAt": "…", "finishedAt": "…", "receiptCutoff": "…", "receiptsDeleted": 1250, "countsDeleted": 0, "countsRepaired": 0 }
}
```

- **Rules:** whole days, **15 to 365** (`Receipt retention must be at least 15 days.`, `Receipt retention can't be more than 365 days (the daily count retention).`). Unknown fields → 400. Non-admins → 403. Default until set: 60.
- **When it applies:** uploads use the new value within a minute (receipts older than the period are refused). Older receipts are **deleted at the next daily run (03:30 IST)**, not at once.
- **Lowering it deletes receipts permanently** at the next run. Confirm first: "Receipts older than N days will be deleted tonight at 03:30. Counts in dashboards and reports are kept."
- **Raising it doesn't bring deleted receipts back.** `receiptsDeletedBefore` is when the last cleanup deleted up to. Uploads stay refused before it, so a deleted receipt can't be uploaded and counted twice. `uploadCutoff` is the effective limit: the later of the period's cutoff and `receiptsDeletedBefore`. Show it as "Receipts are kept from <date>".
- **`lastRun`:** `null` until the first run. `status: "FAILED"` comes with `error`; the next run continues from where it stopped (nothing is lost). Show a warning banner on a failed run. `countsRepaired` > 0 means some receipts were missing from the counts and were added before deletion, which is worth reporting to the backend team.
- Dev runs in dry-run mode (`CLEANUP_DRY_RUN=true`): nothing is deleted and `lastRun` stays as it was.

**UI:** a number input (15–365) with Save, the effective "kept from" date, and the last run (time, status, receipts deleted).

## 9B. Commission rates — READY

Only the **CSP** earns commission (KOs are paid a salary by their CSP): every successful receipt of a CSP or its KOs earns for the CSP, at the rate live when the receipt was uploaded (frozen on the receipt; later changes never rewrite the past). The CSP sees it by month in the app (mobile KT §13B).

| Call | Notes |
|---|---|
| `GET /admin/commission/services` | the 15 services (`code`, `name`, `transactionCategory`, `receiptType`, `group`, `sortOrder`, `isActive`) |
| `PATCH /admin/commission/services/:code` | `{ name?, isActive?, sortOrder? }`; an inactive service earns nothing and is hidden in the app |
| `GET /admin/commission/rates?scope=DEFAULT\|BC\|CSP&scopeId=` | per service: `live` and `next` rate of that scope |
| `POST /admin/commission/rates` | `{ serviceCode, scope, scopeId (BC id / CSP agentId; not for DEFAULT), type: FLAT\|PERCENT\|SLAB\|INHERIT, amount (FLAT ₹), percent (PERCENT), slabs (SLAB), minAmount?, maxAmount? (PERCENT / SLAB, per receipt), effectiveFrom? (now or later; default now), reason? }` → 201 |
| `DELETE /admin/commission/rates/:rateId` | only a rate that hasn't started (`This rate is already in use; set a new rate instead.`) |
| `GET /admin/commission/rates/history?serviceCode=&scope=&scopeId=` | every rate, newest first |

- **Precedence** at upload: the CSP's own rate, else its BC's, else DEFAULT. `INHERIT` on a BC / CSP scope removes its override from that date (the next level applies again). DEFAULT can't inherit. No rate = ₹0.
- A new rate replaces the scope's rate from its `effectiveFrom`; a past `effectiveFrom` is refused (400).
- **Slabs (rev 17):** `type: "SLAB"` with `slabs: [{ from, to, type: "FLAT"|"PERCENT", amount?, percent? }]` — amount bands sorted by `from` (`from` inclusive, `to` exclusive; `to: null` = "and above", only on the last band; gaps allowed and earn ₹0; at most 20). The band the receipt amount falls in applies; `minAmount` / `maxAmount` then cap the result per receipt. Example: `{ "serviceCode": "CW", "scope": "DEFAULT", "type": "SLAB", "maxAmount": 25, "slabs": [ { "from": 0, "to": 1000, "type": "FLAT", "amount": 5 }, { "from": 1000, "to": null, "type": "PERCENT", "percent": 1 } ] }` → `rateLabel` `₹0–1000: ₹5; ₹1000+: 1% (max ₹25)`. Rates in answers carry `slabs` (null unless SLAB). UI: a band editor (add row, from / to / FLAT ₹ or %), validated live.
- Errors: 404 `Service not found.` / `BC not found.` / `CSP not found.`; 400 `amount is required for a FLAT rate.`, `percent is required for a PERCENT rate.`, `slabs are required for a SLAB rate.`, `Slab N overlaps slab N+1: sort them by amount, without overlaps.`, `Slab N: "to" must be more than "from".`, `Slab N: amount is required for a FLAT slab.`, `minAmount can't be more than maxAmount.`, `scopeId is required for a BC or CSP rate.`
- The CSP app shows today's and this month's commission on its dashboard (`commission.today` / `.month`); the console's global dashboard gets the same block (whole system without `agentId`).

UI: a rate card per scope (Default; search a BC or CSP for overrides): one row per service with the live rate, the next one and "Change"; a history drawer.

## 9C. Receipt fields — READY

Which receipt fields the desktop sends. **`rrn` and `location` are fixed defaults** (always on); the super admin **selects extra fields** from a multi-select (rev 17). The list reaches every PC in the next heartbeat; fields that aren't allowed are never stored. **There's no Aadhaar field.**

- `GET /admin/receipt-fields` →
  ```json
  { "fixed":   [ { "field": "rrn", "label": "RRN", "personal": false }, … ],
    "options": [ { "field": "bankName", "label": "Bank name", "personal": false }, …, { "field": "slip", "label": "Slip image", "personal": true } ],
    "selected": ["bankName"],
    "allowed":  ["rrn", "stan", "terminalId", "location", "bankName"] }
  ```
  Options: `stan`, `terminalId`, `bankName`, `bankTransactionId`, `bankResponseCode`, `bankResponseMessage`, `balanceAfter`, `customerName`, `customerAccount`, `slip` (the PC uploads a picture of the slip; the CSP app shows "View slip").
- `PATCH /admin/receipt-fields` `{ "extra": ["bankName", "customerName"] }` — the **full** selection (replaces the previous one; `[]` = defaults only) → the same shape. 400 for an unknown field or a fixed one (`rrn, location are always shown; send only the extra fields.`). The old `{ "customerName": true }` form is gone (400).
- UI: the fixed two as locked chips, then a multi-select dropdown of `options` pre-filled with `selected`; Save sends the whole selection. Confirm before adding a `personal` one ("customer data will be stored on the server").

## 9D. Billing: GST and grace period — READY (rev 17)

- `GET /admin/billing-settings` → `{ graceDays, gstPercent }` (defaults 0 and 18).
- `PATCH /admin/billing-settings` `{ graceDays?, gstPercent? }` — `graceDays` 0–30 whole days; `gstPercent` 0–28, at most 2 decimals → `{ graceDays, gstPercent, updatedSubscriptions }`.
- **GST** applies to **subscriptions only**: plan prices are before tax; checkout adds GST (`create-order`: `amount` + `taxAmount` = `totalAmount`, with `taxPercent`); plans show `gstPercent`, `gstAmount`, `priceWithGst`. A paid payment gets an `invoiceNumber` (`INV…`). Revenue (§12) and `Subscription.amountPaid` are **without GST**; show GST collected separately (sum of `taxAmount`) when the revenue console is built. A new rate applies to new orders (orders already created keep theirs); cached up to a minute.
- **Grace period**: running subscriptions get `graceEndsAt = endDate + graceDays` (updated at once for every ACTIVE subscription when you change it — `updatedSubscriptions` says how many; 0 clears it). The app and the PCs keep working until `graceEndsAt`; a renewal during grace continues from the old end date. Expired subscriptions aren't revived.
- UI: two number fields with Save; for grace, warn "applies to every running subscription now".

## 9E. Users: block / suspend at once — READY (rev 17)

- `GET /admin/users/:agentId/status` → `{ id, agentId, email, role, status, statusReason, statusChangedAt, lastLoginAt, activeSessions }`.
- `PATCH /admin/users/:agentId/status` `{ status: "BLOCKED" | "SUSPENDED" | "ACTIVE", reason? }` — `reason` (≤ 300) **required** to block / suspend; it's shown to the user ("Your account has been blocked. Reason: …"). → `{ …, revokedSessions }`, audited (`AuditLog`, entity USER).
- **Effect at once:** every session ends and the user's next API call (even with a still-valid token) gets 403 `ACCOUNT_BLOCKED` / `ACCOUNT_SUSPENDED`; login and refresh refuse too. `ACTIVE` lifts it (reason cleared). With several API servers it can take up to 10 s on the others.
- Errors: 404 `User not found.`; 400 `A super admin account can't be blocked here.`; 400 `This account hasn't finished signing up yet.` (PENDING).
- **Not affected:** the user's desktop PCs (they authenticate with their own machine key). To stop a PC, revoke its activation (§4A).
- UI: on the agent detail (§7): status badge, "Block" / "Suspend" / "Reactivate" with a reason dialog; show `activeSessions`.

## 9F. Receipt problem reports — READY (rev 17)

CSPs and BCs report a problem on a receipt from the app (reason + optional note). One open report per receipt; each keeps a copy of the receipt, so it stays readable after retention deletes the receipt.

- `GET /admin/receipt-reports?status=OPEN|RESOLVED|REJECTED&ownerAgentId=&page=&limit=` (limit ≤ 100, default 20) → `{ items: [{ id, receiptId, ownerAgentId (the CSP), reportedBy, reason, reasonLabel, details, status, resolution, resolvedAt, createdAt, receipt: <full receipt copy> }], openCount, pagination }`.
- `PATCH /admin/receipt-reports/:reportId` `{ status: "RESOLVED" | "REJECTED", resolution }` (resolution 1–1000, required) → the report. 409 when already closed.
- Reasons: `WRONG_AMOUNT`, `WRONG_STATUS`, `DUPLICATE`, `MISSING_DETAILS`, `NOT_MY_TRANSACTION`, `OTHER`.
- UI: an inbox with an `openCount` badge (poll, no push yet), filter by status / CSP, detail with the receipt copy and a resolve / reject form. The CSP sees `status` and `resolution` in the app.
- The receipt PDF and slip are also available to the super admin: `GET /receipts/:receiptId/pdf?agentId=` and `GET /receipts/:receiptId/slip?agentId=` (mobile KT §13).

## 10. Other endpoints the console can use

- `POST /csp-visits`, `GET /csp-visits/:id`, `GET /csp-visits/csp/:cspAgentId` — allowed for SUPER_ADMIN (mobile KT §16). Upload works the same from the browser (presigned POST via `FormData` / `fetch`).
- `GET /uploads/presigned-url?key=…` — a super admin can fetch any stored file (signed URL, 5 minutes).

## 11. Known backend gaps (admin console)

| # | Gap | Effect | Proposed fix |
|---|---|---|---|
| G1 | ~~Super admin blocked by subscription checks~~ | — | **fixed 2026-10-25** |
| G2 | ~~No way to create a super admin~~ | — | **fixed 2026-10-25**: `npm run seed:super-admin` |
| G3 | No admin APIs for subscriptions (grant/extend/cancel) or payments (list all); block / suspend **built** (§9E) | those pages can't be built | backend; the read-only lists and count cards are planned in §12 |
| G4 | ~~15-minute access token, no refresh endpoint~~ | — | **fixed rev 15**: `POST /auth/refresh` (+ forgot / reset / change password, rev 17: mobile KT §5.2) |
| G5 | `POST /agents/csp` as SUPER_ADMIN uses the admin's own id as the BC | creating a CSP from the console fails or links to a non-BC | add a `bcId` body field for admins |
| G6 | No unlink endpoint for BC↔CSP | a wrong approval can't be undone from the console | `POST /bc-links/unlink` |
| G7 | No push/realtime | poll the pending list (e.g. every 60 s) for new requests | future |

## 12. Planned: subscribers, revenue and pricing console — NOT BUILT

Owner request (2026-10-31). **Neither the backend APIs nor the screens exist yet.** The backend builds the APIs below first, then the console. The endpoint names and shapes are a draft; this KT will be updated when they're built.

### 12.1 Home: count cards (click a card → its list)

Decided by the owner on 2026-11-01. Everything counts **per subscription** (12.6).

| Card | Meaning | List behind the card |
|---|---|---|
| **Total revenue** | all `SUCCESS` payments since launch | the payments (columns below) |
| **This month's revenue** | `SUCCESS` payments with `paidAt` in the current IST month | the same, for this month |
| **Active subscriptions** | `ACTIVE` and today is **on or before the end date**. Subscriptions in a grace period are **not** included | owner (BC/CSP), plan, cycle, machines (`machineLimit`), start, end, amount paid |
| **In grace period** | past the end date but on or before `graceEndsAt`: still working, not paid. Counted and listed **separately** | owner, plan, machines, ended on, grace ends on, days left, contact |
| **Stopped, not renewed** | the subscription has **stopped** and the owner has **no** newer subscription. Second figure: the machines those subscriptions covered | owner, plan, machines, stopped on, days since, last amount paid, contact (mobile/email) |

**Revenue figures** are shown **before tax** (`amount`), **tax** (`taxAmount`) and **after tax** (`totalAmount`), with the payment count. Payment list columns: payment number, owner, plan, billing cycle, machines, before tax, tax, after tax, paid at.

**Any month or any period:** the revenue page has a month picker (any past month) and a custom from–to range. It also shows a month-by-month table and chart (12.4, `GET /admin/revenue/summary`). The two cards are fixed: all time, and the current month.

**When a subscription stops:** on its **stop date** = `graceEndsAt` if set, otherwise `endDate`.
- **Grace is 0 today.** No subscription gets a `graceEndsAt`, so it stops on the end date and the "In grace period" card shows 0.
- **When a grace period is added later** (a super admin setting, not built: checklist 4.1), new subscriptions get `graceEndsAt = endDate + grace`. The stop date then moves to the end of grace, and those subscriptions appear under "In grace period" until then. The backend already keeps a subscription working until `graceEndsAt`, so only the setting and these lists need the change.
- **Lists:** "stopped on" is the stop date. Ranges filter on it.

**Renewed or not:** an owner with any newer subscription (any plan) counts as renewed (proposed, 12.5).

Filters on every list: date range (IST days), owner type (BC / CSP / all), plan. Lists are paginated and searchable by agent ID / name.

### 12.2 Subscribers

- **List:** every BC and CSP that has bought a subscription (current or past): agent ID, name, type, current plan and cycle, status, machines, end date, total paid.
- **Detail (click a row):** subscription history, payments, activations / machines, and the **agents under them**: BC → its CSPs → their KOs (including CSPs linked through the ₹799 plan), CSP → its KOs.

### 12.3 Plan pricing (all plans, all billing cycles)

Editing already works: `PATCH /subscriptions/plans/:planId/pricing` sets the price for `MONTHLY`, `QUARTERLY`, `HALF_YEARLY` or `YEARLY` on any plan (§5). What's missing is an admin list that also returns **inactive** plans and cycles (the public list hides them), so the pricing page can show and re-enable them.

### 12.4 Draft backend APIs (SUPER_ADMIN only)

| Draft endpoint | Returns |
|---|---|
| `GET /admin/overview?ownerType=` | the five cards: `{ revenue: { total: R, currentMonth: R }, activeSubscriptions: { count, machines }, inGrace: { count, machines }, notRenewed: { count, machines }, machinesDropped }`, where `R = { beforeTax, tax, afterTax, paymentCount }` |
| `GET /admin/revenue/summary?month=YYYY-MM` or `?from=&to=` (optional `ownerType`, `planId`, `groupBy=month\|day`) | revenue for **any month or any period**: `{ from, to, total: R, byPlan: [{ planId, planCode, ...R }], byOwnerType: { BC: R, CSP: R }, series: [{ label, ...R }] }`. No `month` and no dates = all time |
| `GET /admin/revenue/payments?month=` or `?from=&to=` (`ownerType`, `planId`, `search`, `page`, `limit`) | the payments behind the revenue figures |
| `GET /admin/subscriptions?status=ACTIVE\|IN_GRACE\|NOT_RENEWED&ownerType=&planId=&from=&to=&search=&page=&limit=` | the lists behind the other cards; `from` / `to` filter `NOT_RENEWED` by the stop date |
| `GET /admin/subscribers?ownerType=&search=&page=&limit=` | owners with a subscription summary |
| `GET /admin/subscribers/:ownerId` | owner, subscriptions, payments, activations, agent tree |
| `GET /admin/plans` | all plans and pricings, including inactive |

Rules for the revenue APIs:
- Months and days are **IST**, by `paidAt`.
- `month` can't be in the future: 400 `Future month is not allowed.`
- `from` must be ≤ `to`.
- Money is returned as strings with 2 decimals (like `price`). Add them up with a decimal library, not floats.
- Refunds (Razorpay, later) will be subtracted and shown as their own figure.

The data exists today: `Subscription` (`ownerType`, `ownerId`, `planId`, `status`, `startDate`, `endDate`, `graceEndsAt`, `machineLimit`, `amountPaid`) and `Payment` (`status`, `amount`, `taxAmount`, `totalAmount`, `paidAt`, `billingCycle`, `machineCount`).

### 12.5 Decisions

1. Revenue: before tax, tax and after tax; total and current month on the cards; any month or period through the API (owner, 2026-11-01). Open: how refunds are shown (none exist yet).
2. "Stopped, not renewed": per subscription, machines as the second figure (owner, 2026-11-01).
3. Stop date = end of grace (`graceEndsAt`), or the end date while grace is 0 (owner, 2026-11-01).
4. "Active" excludes the grace period; grace has its own count and list (owner, 2026-11-01).
5. Open: does a renewal on a different plan count as renewed? (Proposed: yes, any newer subscription.)

### 12.6 Per subscription or per activation? (recommendation)

**Decided (owner, 2026-11-01): per subscription, with machines (activations) next to it.**

- **The subscription is what gets renewed and paid for.** An owner decides once, and all its activations end together. Counting activations would make one BC with 20 machines look like 20 lost customers.
- **Per subscription is per owner.** Only the owner's latest subscription is looked at, so an owner is counted once, however many times they renewed before.
- **Activations still matter for money.** A CSP plan is priced per machine, so the card also shows "machines" (the activations those subscriptions covered).
- **Machines dropped:** a renewal with fewer machines (5 → 3) isn't a lost subscription but does lose 2 machines. This shows on the home page as its own figure, `machinesDropped`, with a list of the owners who reduced.

## 13. Changelog

- 2026-11-04 (rev 17) — New §9D billing settings (GST % on subscriptions, grace days), §9E block / suspend users at once, §9F receipt problem reports. §9B: `SLAB` commission rates. §9C: fixed default receipt fields (`rrn`, `location`) + multi-select extras (`stan`, `terminalId` now optional too) (`{ extra: [...] }`; new `slip` option). Password reset / change for every login (mobile KT §5.2).

- 2026-11-04 (rev 16) — New §9B commission rates (services, rates per scope with precedence CSP > BC > default, history) and §9C receipt fields (which optional fields the desktop may send; no Aadhaar).

- 2026-11-04 (rev 15) — Login now creates a session: `POST /auth/refresh { refreshToken }` returns new access + refresh tokens (rotate; an old refresh token used again ends the session) and `POST /auth/logout { refreshToken }` ends it; use them in the admin console (mobile KT §5.2–5.3). Errors carry `TOKEN_EXPIRED`, `REFRESH_TOKEN_INVALID`, `SUBSCRIPTION_*` and other codes (mobile KT §3).

- 2026-11-03 (rev 14) — BCs on the ₹799 plan can't create CSPs / KOs (`PLAN_LINK_ONLY`); only machine-plan BCs can. A super admin creating a CSP isn't affected.

- 2026-11-03 (rev 13) — Pool views add `cashDueExtra`; dues have `cashSide`; every error answer has a stable `code` next to `message`.

- 2026-11-03 (rev 12) — §8: read-only labels, balance due, day closes and tasks per CSP; `cashOther` on pool views.

- 2026-11-02 (rev 11) — §8: pool views show `cashLeftInBank` (left in bank by partly delivered KO settlements) next to `cashInTransit`; settlement items have `leftInBank`.

- 2026-11-02 (rev 10) — §8: KO settlements feed (read-only).

- 2026-11-02 (rev 9) — §8: cash management views for the admin (read-only).
- 2026-11-01 (rev 8) — §8: `agentId` selection rule (CSP = CSP + KOs), multi-value receipt filters and `period`; reports count KOs on their CSP's row.
- 2026-11-01 (rev 7) — §12 decisions: per subscription; stop date = end of grace (grace 0 today, adapts when a grace period is added); active excludes grace, with a separate "In grace period" card and list; revenue cards for total and current month; `GET /admin/revenue/summary` and `/admin/revenue/payments` for any month or period (draft).
- 2026-11-01 (rev 6) — New §9A: receipt retention setting (15–365 days, default 60), effective upload cutoff, last cleanup run. §12: revenue shown before and after tax; "not renewed" counted per subscription with machines as a second figure, plus machines dropped on downsized renewals (12.6).
- 2026-10-31 (rev 5) — New §12 (planned, not built): subscribers list with their agents, revenue / active / not-renewed count cards with lists, admin plan list for pricing; draft APIs and open questions. §8: receipt retention (60 days; counts 1 year).

- 2026-10-30 (rev 4) — New §4A: activation revoke requests (owners request, super admin approves/rejects); direct revoke stays admin-only.
- 2026-10-30 (rev 3) — New §9: desktop settings (global service switches for maintenance, denomination popup, `minimumVersion` / `latestWatcherVersion` / `downloadUrl` / `portalUrl`) and per-machine desktop controls; revoke any activation. Rate limits (429).

- 2026-10-25 (rev 2) — Super admin account (`npm run seed:super-admin`) and access without a subscription: global dashboards, machines, transactions, reports and agent edit/delete now work (G1, G2 fixed). Reports return all CSPs for the admin. IST day boundaries.
- 2026-10-25 (rev 1) — Initial version: auth/BFF guidance, link-request review (CSP + KOs, conflicts), plan pricing, metric definitions, agents directory, blocked global views (G1) and other gaps.
