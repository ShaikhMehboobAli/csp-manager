# CSP Manager Super Admin Console (React / Next.js) — KT

**Audience:** the web team building the **Super Admin** console in React / Next.js.
**Not covered here:** the BC/CSP mobile app → `docs/mobile-app-kt.md` (read its sections 3 and 18 for API conventions, errors and dates; they apply here too); the desktop app → `docs/desktop-integration-changes.md`.
**Backend source of truth:** `csp-manager/apps/api`.
**Last updated:** 2026-11-12 (rev 25)

> **Rev 25 (2026-11-12): Razorpay is live in test mode.** Payments show `paymentProvider: RAZORPAY`, `transactionReference` = the Razorpay order id (`order_…`), `gatewayTransactionId` = the Razorpay payment id (`pay_…`); search them in the Razorpay Dashboard. Mandates show `providerMandateId` (UPI token `token_…`), `providerCustomerId`, `maxAmount`. A renewal payment flagged "refund due" in `failureReason` must be refunded in the Razorpay Dashboard (no refund API yet). Renewals start 2 days before the end date.

> **Rev 24 (2026-11-12): metric values are super-admin only** — `POST` / `PATCH /metrics/values` now refuse BC admins (403). Build the value entry screen in the console (§6).

> **Rev 23 (2026-11-11): new §9M** — a super admin notification inbox: new revoke requests, new link requests and new problem reports now create notifications for every active super admin (`GET /notifications`, `POST /notifications/:id/read`). The super admin's own login also takes the optional push token fields (mobile KT §5.2); the console sends none.

> **Rev 22 (2026-11-08): new §9L** — app config (support contacts, minimum app version: `GET` / `PATCH /admin/app-config`), desktop log uploads (`/admin/diagnostics`, `POST /admin/machines/:machineId/diagnostics`), and what the app / desktop requirements changed in data the console shows (BC unlink → link request `UNLINKED`, agent `sbiUserId`, receipt `source` / "Count needed", day close cash in account, ledger `RECEIPT_COUNT`, own profile `/auth/me`).

> **Rev 21 (2026-11-08): read §9K** — one checklist of every API change in rev 19–20 (price change → new mandates, renewal blocking, free trial): request / response, success and failure handling, and which console screens they affect.

> **Rev 20 (2026-11-07):** new §9J **free trial**: settings (days, machines, plans, on/off), trial list, extend days / machines, and the trial registry (one trial per agent ID / mobile / email / PC).

> **Rev 19 (2026-11-07):** a price change in §5 now **replaces running CSP mandates at the new price** (response adds `mandatesReplaced`, `mandateFailures`); CSP plans are **blocked during renewal retries** and have **no grace period** (§9D, §9G).

> **Rev 18 (2026-11-07):** read §9G (CSP billing: ₹450 removed, upgrade-only with the difference, UPI mandate renewals, cancel, plan blocking), §9H (cash: worked-out limit, KO cash moves, Adjust requests, activation differences, shared PCs) and §9I (data cleanup script). The super admin is never blocked by a plan.

> Describes the backend once PRs #3–#8 are merged into `development`.

---

### UI wording (owner's terms, 2026-11-08)

The owner renamed the user-facing terms in the mobile app; use the same words in the Super Admin console so support, BCs and CSPs talk about the same things. This KT keeps the API words because they are the field and code names; translate them only on screen.

| In the API, database and code (unchanged) | Say on screen |
|---|---|
| CSP (`type: "CSP"`, `CSP_ADMIN`, the owner of a cash pool) | **KO** |
| KO (`type: "KO"`, an operator under a CSP) | **Sub KO** |
| BC | **BC** (unchanged) |
| a CSP's `agentId` | **KO ID** |
| a KO's `agentId` | **Sub KO ID** |
| the login ID (`agentId` on login, signup, forgot password, profile) | **KO/BC ID** (CSP and BC owners both use it) |
| `cashInAccount` (cash in account, the shared holding) | **Cash holding** |
| `cashInTransit` (money sent to the bank in a KO settlement) and `cashLeftInBank` (what the bank didn't deliver) | **Current A/c** — one amount (their sum) where they're shown together; "Current account" where there's room, e.g. the ledger title "Sent to current account" |

Rules:
- **Only the words change.** Endpoint paths, field names, enum values, error `code`s and ledger types stay exactly as documented (`cashInAccount`, `CASH_IN_ACCOUNT`, `KO_CREATION`, `type: "KO"`, …). Never rename an API field to match the label.
- Lower case in the middle of a sentence ("Added to cash holding", "goes through cash holding"); capital only at the start of a label ("Cash holding", "Current A/c").
- Plan names stay as the super admin set them (e.g. "BC CSP Link").
- Server `message` texts the user sees should follow the same words when they're next edited (e.g. "Not enough cash in account" → "Not enough cash holding").

Where the console lists agents, show `type: "CSP"` as **KO** and `type: "KO"` as **Sub KO** (filters, columns, detail pages, link requests: "Link a KO", "KO and its Sub KOs"). Cash screens: Cash holding, Current A/c.

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

Rules: new prices apply to new purchases; running subscriptions keep what they paid. **Rev 18 (CSP):** a CSP subscription stores its **price per machine** (`pricePerMachine`) at purchase / upgrade, **Rev 19 (owner decision): changing a CSP plan's monthly price moves its running subscriptions to the new price from their next renewal.** For each running CSP subscription on the plan (ACTIVE, auto renew, not cancelled, not lapsed) the server sets `pricePerMachine` to the new price, **cancels the running mandate** (`status REPLACED`, `revokeReason` "Plan price changed.") and **creates a new mandate** for new price × machines + GST, first charge at `endDate`; the current period isn't charged again. The CSP is notified (`MANDATE_REPLACED`); with Razorpay the CSP must approve the new mandate in the UPI app before the end date, or the plan stops then. The `PATCH /subscriptions/plans/:planId/pricing` response adds `mandatesReplaced` (count) and `mandateFailures` (a **count** of subscriptions whose mandate couldn't be replaced because of a gateway error; **save the same price again to retry them**, done ones are skipped). UI: before saving a new CSP monthly price, confirm "N running subscriptions will move to the new price and get a new UPI mandate". Same price saved again → nothing happens. Half-yearly / yearly and BC prices don't touch mandates. Upgrade differences use the stored price and the current new price. The ₹450 `CSP_AUTOMATION_CASH_MANAGEMENT` plan is **inactive** (removed 2026-11-07); it no longer appears in `GET /subscriptions/plans` — keep it out of the pricing UI (or show it greyed "retired"). The seed script never overwrites prices set here. ₹799 BC plan (`BC_CSP_LINK`) defaults: 799 / 4794 / 9588 (monthly / half-yearly / yearly = 799 × months).

**UI:** a page per owner type; one card per plan (code, name, machine limit, features) with an editable row per cycle (price, duration, active toggle, Save). "Add billing cycle" asks for cycle, price and duration. The plan list returns only active cycles, so an inactive cycle disappears after a refetch: keep it in local state for the session, and show "inactive cycles are hidden".

## 6. Metric definitions

| Call | Body / query | Notes |
|---|---|---|
| `GET /metrics?category=&source=&isActive=` | | list |
| `GET /metrics/:metricId` | | detail |
| `POST /metrics` | `{ code, name, category, source, inputType?, description? }` | SUPER_ADMIN |
| `PATCH /metrics/:metricId` | `{ name?, category?, source?, inputType?, description? }` | SUPER_ADMIN (code can't change) |
| `PATCH /metrics/:metricId/status` | `{ isActive: boolean }` | SUPER_ADMIN |
| `GET /metrics/values?agentId=&metricId=&from=&to=` | | entered values (any CSP) |
| `POST /metrics/values` | `{ metricId, agentId (a CSP), date (YYYY-MM-DD), value ≥ 0 }` | **SUPER_ADMIN only (rev 24)** → 201 |
| `PATCH /metrics/values/:valueId` | `{ value }` | **SUPER_ADMIN only (rev 24)** |

Rules: `code` 2–50 chars, `^[A-Z0-9_]+$` (`Code must contain only uppercase letters, numbers, and underscores.`); `name` 2–100; `category` `SOCIAL_SECURITY|TRANSACTION|VISIT|MANUAL|OTHER`; `source` `RECEIPT` (counted from uploaded transactions, matched by `code` to a receipt type/category) or `MANUAL` (**the super admin enters daily values here**, rev 24; BCs no longer can); `inputType` `COUNT|NUMBER|BOOLEAN`; `description` ≤ 500.

UI: table with an active toggle; a create/edit form. Warn before deactivating ("values can no longer be entered; dashboards stop showing it").

**Metric values screen (rev 24, new):** pick a CSP (search) and a date → list the active `MANUAL` metrics with number inputs → `POST /metrics/values` per metric (no bulk endpoint). An existing value for that CSP and date → 400 `Metric value already exists for this CSP and date.` → edit it with `PATCH /metrics/values/:valueId` (find the id with `GET /metrics/values?agentId=&from=&to=`). Other errors: `Metric not found.`, `Metric is inactive.`, `Values can only be entered manually for manual metrics.`, `Manual metric values can only be assigned to a CSP.`

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
- **Grace period** (**BC plans only** since rev 19 — CSP plans renew by mandate and always have `graceEndsAt: null`; changing `graceDays` sets CSP ones to null): running BC subscriptions get `graceEndsAt = endDate + graceDays` (updated at once for every ACTIVE subscription when you change it — `updatedSubscriptions` says how many; 0 clears it). The app and the PCs keep working until `graceEndsAt`; a renewal during grace continues from the old end date. Expired subscriptions aren't revived.
- UI: two number fields with Save; for grace, warn "applies to every running subscription now".

## 9G. CSP billing rules (rev 18) — READY (gateway: dev stand-in)

What the console needs to know to support CSPs (no new admin endpoints yet; the revenue / subscribers console §12 should show these fields when built):

| Topic | Rule |
|---|---|
| Plans | CSP: `CSP_AUTOMATION` ₹250 (desktop automation only), `CSP_COMPLETE` ₹550 (+ cash management + the app's dashboard / machines / cash / reports). ₹450 retired. |
| Purchase | `Payment.purpose = PURCHASE`; creates the subscription, its activations and a **monthly UPI mandate** (`SubscriptionMandate`: `status` PENDING / ACTIVE / CANCELLED / REVOKED / COMPLETED / REPLACED (price change, rev 19), `amount` incl. GST, `startAt` = first charge = end date, `endAt` = +25 years, `provider` MANUAL in dev / RAZORPAY later). |
| Upgrade | Only higher plan and/or more machines, only in the first **12 days** of the period (`currentPeriodStart`), charged the **difference** `(new − old price) × old machines + new price × added machines` + GST; `purpose = UPGRADE`, `previousPlanId`, `previousMachineCount`; same subscription and dates; history `UPGRADE` (`remarks` "Machines 1 → 2"). No downgrade / fewer machines (cancel + new purchase). |
| Renewal | `SubscriptionRenewalJob` (every minute) charges the mandate at `endDate`; success → +30 days, history `RENEWAL`, payment `purpose = RENEWAL` (`attemptNumber`, `mandateId`); failure → retry after 15 min, max 3 attempts (history `RENEWAL_FAILED`), then **stopped at once**: `status EXPIRED`, `lapsedAt`, history `LAPSED`. **During the retries the plan is blocked** (rev 19, owner decision): `status` stays `ACTIVE` but `endDate` has passed and `graceEndsAt` is null, so the app (403 `RENEWAL_PENDING`) and the PCs stop until a charge succeeds. The hourly expiry job leaves these to the renewal job. A purchase meanwhile → 409 `RENEWAL_IN_PROGRESS`; the CSP may cancel meanwhile (ends now). A charge unanswered for 30 min counts as failed; a renewal unresolved 6 h after `endDate` is lapsed (safety net). A late success after a new plan was bought (or for a period already renewed) is recorded as `SUCCESS` with `failureReason` "…refund due." — **list these for manual refunds** (`purpose = RENEWAL`, `failureReason` ending "refund due."). In subscriber lists show them as **"Renewal in progress"** (ACTIVE, `endDate < now`, `autoRenew`, no `cancelledAt` / `lapsedAt`). |
| Cancel | By the CSP: `cancelledAt`, `cancelledBy`, `cancelReason`, `autoRenew = false`, mandate CANCELLED, history `CANCELLATION` (amount 0); **no refund**; works until `endDate` (no grace). |
| Mandate removed in the UPI app | Gateway webhook → mandate `REVOKED`; no retries; the plan stops at `endDate`. |
| Blocking | A CSP without a running subscription can only manage KOs, see payments / plan history and subscribe; ₹250 CSPs get "Please upgrade the plan." on dashboard / machines / cash / reports (server 403 `SUBSCRIPTION_REQUIRED` / `PLAN_UPGRADE_REQUIRED`). PCs stop automation and cash at once. **SUPER_ADMIN and BC users aren't gated by this.** |
| One activation per agent | Assigning a code to an agent that already holds one (unused or running) → 400 `AGENT_ALREADY_HAS_ACTIVATION`. Dev data has agents that got two before the fix; revoke the extra one if needed (§4A). |

**Ops endpoints (not for the console UI):** `POST /payments/mandates/webhook` (header `x-webhook-secret`) with `{ event: "MANDATE_ACTIVATED" | "MANDATE_REVOKED", mandateId, reason? }` or `{ event: "CHARGE_SUCCEEDED", paymentId, gatewayTransactionId }` / `{ event: "CHARGE_FAILED", paymentId, reason, retryable }`. Dev: server env `DEV_MANDATE_RESULT=SUCCESS|FAILED|PENDING` drives the stand-in gateway. `prisma/scripts/backfill-mandates.ts` gave subscriptions created before mandates a mandate (run 2026-11-07 on dev).

**Suggested console additions (with §12):** subscription detail with mandate status / amount / next charge, renewal attempts and `lastRenewalFailure`, payment list filter by `purpose`, a "Lapsed this week" count card.

## 9H. Cash management changes (rev 18) — READY

The super admin reads cash with `agentId` as before (`GET /cash-management`, `/ledger`, and the new **`GET /cash-management/adjustments?agentId=&status=`**). What changed:

- **The cash limit is worked out**, never entered: Σ cash in hand (CSP + KOs) + cash in account + in bank + left in bank + balance due − other cash. No check compares anything with it. CSP signup and BC CSP creation take only cash in hand + cash in account; ADJUSTMENT refuses `cashLimit`.
- **KO creation** takes the KO's cash in hand from the CSP's own cash in hand (or from the agents the CSP edited in the form); what isn't covered raises the limit (ledger `AGENT_ADDED` with `cashLimitChange`, `ADJUSTMENT` reason `KO_CREATION`).
- **Increase / decrease** by the CSP (ledger `INCREASE` / `DECREASE`, reason `CASH_IN_HAND` / `CASH_IN_ACCOUNT`) moves the limit.
- **Adjust requests** (`CashDrawerAdjustment`): every cash in hand change by the CSP makes a mandatory request for the agent to count the notes on its desktop (`DRAWER_ADJUSTED` in the ledger when done).
- **KO activation difference**: the KO says whether the difference came from / went to cash in account or "other" (limit moves; the CSP gets a notification); ledger `ACTIVATION` with `reason` (`DIFFERENCE_FROM_CASH_IN_ACCOUNT`, `DIFFERENCE_TO_CASH_IN_ACCOUNT`, `OTHER_INCREASED_BY_CSP`, `OTHER_DECREASED_BY_CSP`).
- **KO deleted** → `AGENT_REMOVED` (limit down by its cash in hand); **KO replaced** (`POST /agents/:id/replace`, CSP) → `AGENT_TRANSFERRED` ×2 (PC, cash, dues, tasks, settlements, adjust requests move).
- **Shared PCs:** any KO of a CSP (and the CSP) may use any PC of that CSP; cash follows who logged in to SBI (`Machine.cashAgentId`, `cashAgentLoginMethod` KIOSK / EMAIL_OTP). KO emails are verified by OTP on the desktop (`Agent.emailVerifiedAt`, shown on agent objects).
- **Failed receipts** (SBI receipt page FAILED) are skipped on upload: no counts, commission or cash.
- Agents directory (§7): show `emailVerifiedAt` for KOs; the ledger viewer should show `reason` and `actorType` / `actorId` (audit).

## 9I. Data cleanup script (rev 18) — DEV / PRE-LAUNCH, run by a developer

`npm run cleanup:keep-cash` (in `apps/api`; dry run by default, prints counts) → add `--confirm` to delete; `--with-billing` also deletes subscriptions, payments, mandates, activations, revoke requests and machines (every PC re-activates, every CSP subscribes again). **Keeps:** users, BCs, CSPs and KOs, each CSP's cash in account, every agent's cash in hand and denomination, **open** balance dues, labels and all configuration (plans, prices, features, settings, commission rates, running numbers). **Deletes:** receipts (+ denominations, reports), daily counts, every cash ledger / request / settlement / custom transaction / exchange / day close / task / adjust request, settled dues, machine and activity sessions, idempotency keys, audit logs, float ledger, metric values, CSP visits, notifications, communications, OTPs, user sessions. Then each pool's in bank / left in bank / other cash are set to 0, the **limit is recomputed** (cash in hand + cash in account + balance due) and an `OPENING` ledger row "Baseline after data cleanup" is written. Refuses `NODE_ENV=production`. **Not run yet** — the owner decides when.

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

## 9J. Free trial (rev 20) — READY

A new CSP / BC account (never subscribed) can start **one** free trial from the app with full access for the configured days. The super admin controls it.

**Settings** — `GET /admin/trial-settings`, `PATCH /admin/trial-settings` (any of):
```json
{ "enabled": true, "days": 7, "machineCount": 1, "cspPlanCode": "CSP_COMPLETE", "bcPlanCode": "BC_CSP_LINK" }
```
- `days` 1–365, `machineCount` 1–100 (CSP trials; BC trials use the BC plan's own machine limit), plan codes must be **active** plans of that owner type (400 `TRIAL_PLAN_INVALID`). Defaults as above until saved.
- Applies to trials **started afterwards**; running trials keep their dates — extend them one by one (below). `enabled: false` hides the trial in the app (`reason: TRIAL_DISABLED`).
- UI: a "Free trial" card on the billing settings page: on/off switch, days, machines, two plan dropdowns.

**Trials** — `GET /admin/trials?status=ACTIVE|EXPIRED&search=<agentId or SUB-…>&page=1&limit=20` →
`{ total, page, limit, items: [{ subscriptionId, subscriptionNumber, status, ownerType, owner { agentId, name, mobile, email, type }, plan { code, name }, startDate, endsAt, daysLeft, active, machineLimit, machinesActivated, converted }] }` — `converted: true` = the owner bought a plan afterwards.

**Extend** — `PATCH /admin/trials/:subscriptionId` `{ "extendDays"?: 1–365, "machineCount"?: 1–100 }` (at least one):
- `extendDays` adds days from the current end (or from **now** if it already ended) — an **ended trial comes back** (status ACTIVE again, its PCs work again).
- `machineCount` can only go **up** (400 `TRIAL_MACHINE_DECREASE`); new activation codes are generated for the owner to assign.
- Refused once the owner bought a plan (409 `TRIAL_CONVERTED`); machines only on an ended trial → 400 `TRIAL_ENDED` (add days too).
- Writes history `TRIAL_EXTENDED` and notifies the owner. UI: "Extend" button per row → dialog (days, machines).

**Trial registry (abuse check)** — every trial writes `TrialUsage` rows: the owner's **SBI agent ID, mobile, email** at start, and each **PC fingerprint + activating agent ID** when a trial code is activated. A new account matching any row can't start a trial (`TRIAL_ALREADY_USED`); a PC in the registry can't be activated under another account's trial (`TRIAL_ALREADY_USED_ON_MACHINE`). Rows survive account / subscription / machine deletion and the cleanup script.
- `GET /admin/trial-usages?ownerId=&value=&page=&limit=` → `{ total, items: [{ id, kind (AGENT_ID | PHONE | EMAIL | MACHINE_FINGERPRINT), value, subscriptionId, ownerType, ownerId, agentId, createdAt }] }` (search by phone / email / agent ID / fingerprint).
- `DELETE /admin/trial-usages/:id` → lets that identity take part in a trial again (support cases, e.g. a PC sold to a new owner). Confirm before deleting.

**Reports:** trial subscriptions have `subscriptionType: "TRIAL"`, `amountPaid: 0` — count them separately from paying subscribers in §12 (e.g. "On free trial" card, and "Trial → paid" conversions).

## 9K. API changes in rev 19–20 — what to change in the console (rev 21)

One list of everything the backend changed for the **billing fixes** (rev 19) and the **free trial** (rev 20). Details are in §5, §9D, §9G and §9J. All calls are SUPER_ADMIN only (another role → 403), all errors are `{ success: false, code, message }` — branch on `code`, show `message`. No URL was renamed or removed.

### 9K.1 Summary

| # | API | New / changed | What changed | Console screen |
|---|---|---|---|---|
| 1 | `PATCH /subscriptions/plans/:planId/pricing` | changed | response adds `mandatesReplaced`, `mandateFailures` (counts); a CSP **monthly** price change replaces running mandates | Plans and pricing (§5) |
| 2 | `PATCH /admin/billing-settings` | changed | `graceDays` applies to **BC** only; CSP subscriptions always get `graceEndsAt: null` | Billing settings (§9D) |
| 3 | subscription / payment / mandate data | changed | mandate `status: "REPLACED"`; "renewal in progress" state; `RENEWAL` payments marked "refund due."; `subscriptionType: "TRIAL"` | subscriber lists and detail (§12, when built) |
| 4 | `GET /admin/trial-settings` | **new** | read trial settings | Billing settings → Free trial card |
| 5 | `PATCH /admin/trial-settings` | **new** | change trial settings | same |
| 6 | `GET /admin/trials` | **new** | list trials | Free trials page |
| 7 | `PATCH /admin/trials/:subscriptionId` | **new** | extend days / add machines | Free trials page → Extend |
| 8 | `GET /admin/trial-usages` | **new** | the trial registry | Free trials → Registry tab |
| 9 | `DELETE /admin/trial-usages/:id` | **new** | free an identity for another trial | Registry tab |

### 9K.2 `PATCH /subscriptions/plans/:planId/pricing` (changed)

**Request:** unchanged `{ billingCycle, price, durationDays?, isActive? }`.

**Response 200:** `data { planId, planCode, billingCycle, durationDays, price, isActive, mandatesReplaced, mandateFailures }`.

| Case | Console |
|---|---|
| CSP plan, `MONTHLY`, price changed | **before saving**, confirm "Running subscriptions on this plan move to ₹{price} from their next renewal and get a new UPI mandate. CSPs may have to approve it in their UPI app." After saving show "{mandatesReplaced} mandates replaced" |
| `mandateFailures > 0` | warning "{n} mandates couldn't be replaced (gateway error). Save the same price again to retry." — a retry skips the ones already done |
| same price saved again, BC plan, or another cycle | `mandatesReplaced: 0`, nothing else happens |
| 404 `Plan not found.` / 400 validation | show the message on the form |

### 9K.3 `PATCH /admin/billing-settings` (changed)

Request and response unchanged (`{ graceDays?, gstPercent? }` → `{ graceDays, gstPercent, updatedSubscriptions }`). **Change:** `graceDays` only gives grace to **BC** subscriptions; CSP ones are set to `graceEndsAt: null` (a CSP plan stops at its end date until the mandate renewal succeeds). Label the field "Grace period (BC plans)".

### 9K.4 What the console shows for CSP subscriptions (changed data)

| Data | Show as |
|---|---|
| `status: ACTIVE`, `endDate < now`, `autoRenew`, no `cancelledAt` / `lapsedAt` | **"Renewal in progress"** (the app and PCs are blocked until a charge succeeds; ≤ 3 attempts, 15 min apart; stopped after 6 h) |
| mandate `status: "REPLACED"`, `revokeReason: "Plan price changed."` | "Replaced (price change)"; the subscription's current mandate is the newer one |
| payment `purpose: "RENEWAL"`, `status: "SUCCESS"`, `failureReason` ending "refund due." | **"Refund due"** — the money came in late and extended nothing. Refunds are manual for now: list these for the team |
| `subscriptionType: "TRIAL"`, `amountPaid: 0` | "Free trial"; count separately from paying subscribers |

### 9K.5 Free trial endpoints (new)

| Call | Request | Success | Failures |
|---|---|---|---|
| `GET /admin/trial-settings` | — | 200 `{ enabled, days, machineCount, cspPlanCode, bcPlanCode }` (defaults `true, 7, 1, CSP_COMPLETE, BC_CSP_LINK` until saved) | 401 / 403 |
| `PATCH /admin/trial-settings` | any of `enabled` (boolean), `days` (1–365), `machineCount` (1–100), `cspPlanCode`, `bcPlanCode` | 200 "Trial settings updated. They apply to trials started from now on." + the saved settings | 400 "Send at least one setting." · 400 validation (out of range) · 400 `TRIAL_PLAN_INVALID` "`<code>` is not an active `<CSP\|BC>` plan." |
| `GET /admin/trials` | query `status=ACTIVE\|EXPIRED`, `search` (agent ID or `SUB-…`), `page` (≥ 1), `limit` (1–100, default 20) | 200 `{ total, page, limit, items: [{ subscriptionId, subscriptionNumber, status, ownerType, owner, plan, startDate, endsAt, daysLeft, active, machineLimit, machinesActivated, converted }] }` | 400 validation |
| `PATCH /admin/trials/:subscriptionId` | `{ extendDays?: 1–365, machineCount?: 1–100 }` (at least one) | 200 "Trial updated." `{ subscriptionId, subscriptionNumber, status, active, startDate, endsAt, daysLeft, machineLimit }` | 404 "Trial not found." · 409 `TRIAL_CONVERTED` (owner bought a plan) · 400 `TRIAL_MACHINE_DECREASE` · 400 `TRIAL_ENDED` (machines only on an ended trial — add days too) · 400 "A cancelled / suspended trial can't be extended." · 400 "Send extendDays and / or machineCount." |
| `GET /admin/trial-usages` | query `ownerId`, `value` (phone / email / agent ID / fingerprint), `page`, `limit` | 200 `{ total, items: [{ id, kind, value, subscriptionId, ownerType, ownerId, agentId, createdAt }] }` | 400 validation |
| `DELETE /admin/trial-usages/:id` | — | 200 "Trial usage removed. This identity can take part in a trial again." + the removed row | 404 "Trial usage not found." |

**Console handling:**
- Settings form: disable Save until something changed; after save show the message and "running trials keep their dates".
- Trials list: badges **Active** (`active`), **Ended** (`!active && !converted`), **Converted** (`converted`). Hide **Extend** on converted rows. Extend dialog: days (optional) + machines (min = current `machineLimit`); on an ended trial require days. After success, refresh the row (`daysLeft`, `endsAt`, `machineLimit`); the owner gets a `TRIAL_EXTENDED` notification and new codes for added machines.
- Registry: search box (by value) and filter by owner; **Delete** asks "Allow this {kind} to take part in a free trial again?". `value` is stored normalised (email lower-case without dots / `+tag` for Gmail, phone = last 10 digits, agent ID upper-case) — search with the same form.
- 401 → login; 403 → "super admin only"; network / 5xx → keep the form, show "try again".

## 9L. App config, desktop logs and new data (rev 22) — READY

What the mobile (§19.4 of the mobile KT) and desktop (#35–#39 of the desktop doc) requirements added for the console. All SUPER_ADMIN; errors `{ success: false, code, message }`.

### 9L.1 App config — `GET` / `PATCH /admin/app-config`

What the mobile app reads at start (public `GET /app/config`): support contacts, legal links, minimum / latest version per platform, a banner.

```json
{ "support": { "phone": "+91…", "whatsapp": "+91…", "email": "support@…", "hours": "Mon–Sat, 9:00–19:00" },
  "links": { "terms": "https://…", "privacy": "https://…" },
  "android": { "minVersion": "1.3.0", "latestVersion": "1.4.0", "updateUrl": "https://play.google.com/…" },
  "ios": { "minVersion": null, "latestVersion": null, "updateUrl": null },
  "message": null }
```
- `GET` → the whole object (all `null` until saved). `PATCH` → any part; nested objects **merge** (send only what changes; `null` clears a field) → 200 `App config updated.` + the saved object.
- Rules (400): versions like `1.4.0` (`Use a version like 1.4.0.`), URLs full `https://` (`Use a full https:// link.`), `support.email` a valid email, `phone` / `whatsapp` ≤ 20, `hours` ≤ 100, `message` ≤ 300; empty body → `Send at least one setting.`
- Effect: an app below `minVersion` shows a full-screen "Please update" (with `updateUrl`) and stops working until updated — **raise `minVersion` only after the new build is live in the store.** `latestVersion` shows a dismissible "update available". `message` is a banner on every screen (maintenance etc.; `null` removes it). Changes reach apps within about an hour (cached).
- UI: "App settings" page: support card, links card, one card per platform, banner text with a clear button. Confirm before saving a higher `minVersion`: "Apps below X stop working until updated."

### 9L.2 Desktop logs (diagnostics)

The PC uploads its desktop log (no personal data: page structure, steps, masked digits) **only when asked**. Requests are numbered `DIAG-YYYY-NNNNNN` and kept 14 days.

| Call | Request | Success | Failures |
|---|---|---|---|
| `POST /admin/machines/:machineId/diagnostics` (`:machineId` = machine id or `MAC-…` code) | `{ fromDate?, toDate?, note? }` (IST `YYYY-MM-DD`; default today; **only the last 3 days** (today and the 2 before); not in the future; note ≤ 300) | 201 request `{ id, requestId, machineId, machineCode, fromDate, toDate, status: "OPEN", note, requestedByRole, partsExpected: null, partsReceived: [], bytesReceived: 0, receivedAt: null, createdAt }` | 404 `Machine not found.` · 400 `DIAGNOSTICS_RANGE_TOO_OLD` `Only the last 3 days of logs can be asked for (from 2026-11-06).` / `Dates can't be in the future.` / `` `fromDate` must be on or before `toDate`. `` |
| `GET /admin/diagnostics?machineId=&status=OPEN\|RECEIVED\|CANCELLED&page=&limit=` | — | `{ items: [request], pagination }` newest first | 400 validation |
| `GET /admin/diagnostics/:requestId` (id or `DIAG-…`) | — | the request | 404 `Diagnostics request not found.` |
| `DELETE /admin/diagnostics/:requestId` | — | the request, `status: "CANCELLED"` (only an open one changes) | 404 |
| `GET /admin/diagnostics/:requestId/parts/:part` | — | **`text/plain`** file download (`Content-Disposition: attachment; filename="MAC-…-DIAG-…-part1-2026-11-08.log"`) | 404 `That part hasn't arrived.` |

- A new request for a PC **replaces** its open one (that one → `CANCELLED`). CSPs / BCs can ask too, from the app (`requestedByRole` shows who).
- The PC sees the request on its next heartbeat (≈ 1 min) **while it's switched on**, then sends parts (≤ 1.5 MB each, one a minute). `status: RECEIVED` when all `partsExpected` parts are in (`partsReceived` lists them).
- UI: Machine detail → "Request desktop log" (date pickers limited to today and the 2 days before, note) → a Diagnostics tab: list with status chips, "n of m parts", size, and a download button per part. Poll every 30 s while a request is open.

### 9L.3 What changed in data the console shows

| Where | Change | Show |
|---|---|---|
| Link requests (§4) | new `status: "UNLINKED"` (the BC unlinked an approved ₹799 link; `unlinkedAt`, `unlinkReason`), an audit row (`AGENT` `UPDATE`, "BC … unlinked CSP …") | chip "Unlinked" + date and reason; the CSP and its KOs no longer belong to that BC |
| Agents directory (§7) | agent object adds `sbiUserId` (the SBI kiosk User ID when it differs from the agent ID; set by the CSP; unique) | column / detail row "SBI user ID" |
| Receipts (§8) | `source` (`AUTOMATION` / `MANUAL` / null) and `denominationPending` (notes still to count on the desktop) | chips; filter later if needed |
| Cash ledger viewer (§9H) | new type `RECEIPT_COUNT` (the agent entered a receipt's notes later; drawer only) | label "Notes counted" |
| Day closes | `system.cashInAccount`, `counted.cashInAccount`, `accountDifference` (optional; the KO's SBI reading) | second difference column |
| Own profile | `GET` / `PATCH /auth/me` and `POST /auth/me/email/verify` work for the super admin too (mobile KT §19.4 R20) | optional "My profile" page |
| Push | sent through FCM since rev 23 / mobile rev 32; the phone's token comes with `/auth/login` and `/auth/refresh` (the console sends none) | nothing to build |

## 9M. Super admin notifications (rev 23) — READY

Every **active** super admin gets an in-app notification when:

| `kind` | When | `data` | Open on click |
|---|---|---|---|
| `ACTIVATION_REVOKE_REQUESTED` | a CSP / BC asked to revoke an activation | `requestId, requestNumber, activationId, activationCode, ownerId, machineCode` | Revoke requests → that request (§3) |
| `BC_LINK_REQUESTED` | a BC asked to link a CSP (message says when the CSP is linked to another BC) | `requestId, bcId, cspAgentId, isConflict` | Link requests → that request (§4) |
| `RECEIPT_REPORT_RAISED` | an owner reported a problem on a receipt | `reportId, receiptId, ownerAgentId, reason` | Problem reports → that report (§9F) |

Calls (same as the app, any login):
- `GET /notifications?unreadOnly=true|false&page=&limit=` → `{ items: [{ id, title, message, type, kind, data, isRead, readAt, createdAt }], unread, pagination }`.
- `POST /notifications/:id/read` (`:id` = `all` marks every unread one) → 200.

**UI:** a bell in the header with the `unread` count; poll `GET /notifications?unreadOnly=true&limit=1` every 60 s (the console has no push). Clicking an item marks it read and opens the screen above. The pending-queue polling in §3 / §4 can use this count instead.

What owners now get (for support questions; mobile KT §13D): revoke approved / rejected, direct revoke, link approved / rejected (BC) and "linked to a BC" (CSP), problem report resolved / rejected. Approve / reject / revoke / resolve responses are unchanged.

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

- 2026-11-12 (rev 25) — Razorpay: payment and mandate gateway fields; refunds by hand in the Razorpay Dashboard.

- 2026-11-12 (rev 24) — Metric values: super admin only (`POST` / `PATCH /metrics/values`); new value entry screen in §6.

- 2026-11-11 (rev 23) — §9M super admin notifications (`ACTIVATION_REVOKE_REQUESTED`, `BC_LINK_REQUESTED`, `RECEIPT_REPORT_RAISED`) with the bell / polling guidance; push row in §9L.3 updated.

- 2026-11-08 (rev 22) — New §9L: `GET` / `PATCH /admin/app-config` (support contacts, links, min / latest app version per platform, banner); desktop log requests and downloads (`POST /admin/machines/:machineId/diagnostics`, `GET` / `DELETE /admin/diagnostics/:requestId`, `GET …/parts/:part`); data changes: link request `UNLINKED`, agent `sbiUserId`, receipt `source` / `denominationPending`, ledger `RECEIPT_COUNT`, day close cash in account, own profile.
- 2026-11-08 (rev 21) — New §9K: one checklist of every API change in rev 19–20 (price change → new mandates, BC-only grace, renewal in progress, refund due, the six free trial endpoints) with request / response, success and failure handling and the screens affected. `mandateFailures` is a count.
- 2026-11-07 (rev 20) — §9J free trial: `GET/PATCH /admin/trial-settings`, `GET /admin/trials`, `PATCH /admin/trials/:subscriptionId` (extend days / machines, revive an ended trial), `GET/DELETE /admin/trial-usages`.
- 2026-11-07 (rev 19) — Owner decisions: a CSP monthly price change replaces running mandates at the new price (§5: `mandatesReplaced`, `mandateFailures`; mandate status `REPLACED`); blocked during renewal retries (§9G); grace days apply to BC plans only (§9D); a purchase after a cancel starts now (confirmed).
- 2026-11-07 (rev 18) — New §9G CSP billing rules (₹450 retired, upgrade-only with the difference in the first 12 days, UPI mandate renewals with 2 retries then stop, cancel without refund, plan blocking that never applies to the super admin, one activation per agent, mandate webhook + dev switches), §9H cash changes (worked-out limit, KO cash moves, increase / decrease, Adjust requests and `GET /cash-management/adjustments`, activation differences, KO delete / replace, shared PCs, failed receipts skipped), §9I data cleanup script. §5: renewals keep the subscription's stored price.

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
