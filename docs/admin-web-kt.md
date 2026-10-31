# CSP Manager Super Admin Console (React / Next.js) — KT

**Audience:** the web team building the **Super Admin** console in React / Next.js.
**Not covered here:** the BC/CSP mobile app → `docs/mobile-app-kt.md` (read its sections 3 and 18 for API conventions, errors and dates; they apply here too); the desktop app → `docs/desktop-integration-changes.md`.
**Backend source of truth:** `csp-manager/apps/api`.
**Last updated:** 2026-10-30 (rev 4)

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

Same endpoints and shapes as the mobile KT §11–§14; for the super admin they cover **all agents** (narrow with `agentId`):

`GET /dashboard/summary` (multi-agent view: `machineMonitoring` across all machines), `/dashboard/analytics`, `/dashboard/csp/:agentId/detail`, `/machines/list`, `/machines/:id`, `/machines/:id/analytics`, `/machines/:id/activity-sessions`, `/receipts`, `/receipts/:receiptId`, `/receipts/stats`, `/receipts/export`, `/reports/summary` (one row per CSP), `/reports/export`.

- Day boundaries are IST (mobile KT §18).
- `GET /activations` returns only the caller's **own** activations (none for an admin); there's no admin-wide activation list yet (G3).

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

## 10. Other endpoints the console can use

- `POST /csp-visits`, `GET /csp-visits/:id`, `GET /csp-visits/csp/:cspAgentId` — allowed for SUPER_ADMIN (mobile KT §16). Upload works the same from the browser (presigned POST via `FormData` / `fetch`).
- `GET /uploads/presigned-url?key=…` — a super admin can fetch any stored file (signed URL, 5 minutes).

## 11. Known backend gaps (admin console)

| # | Gap | Effect | Proposed fix |
|---|---|---|---|
| G1 | ~~Super admin blocked by subscription checks~~ | — | **fixed 2026-10-25** |
| G2 | ~~No way to create a super admin~~ | — | **fixed 2026-10-25**: `npm run seed:super-admin` |
| G3 | No admin APIs for users (block/suspend), subscriptions (grant/extend/cancel) or payments (list all) | those pages can't be built | backend |
| G4 | 15-minute access token, no refresh endpoint | frequent re-login | `POST /auth/refresh` |
| G5 | `POST /agents/csp` as SUPER_ADMIN uses the admin's own id as the BC | creating a CSP from the console fails or links to a non-BC | add a `bcId` body field for admins |
| G6 | No unlink endpoint for BC↔CSP | a wrong approval can't be undone from the console | `POST /bc-links/unlink` |
| G7 | No push/realtime | poll the pending list (e.g. every 60 s) for new requests | future |

## 12. Changelog

- 2026-10-30 (rev 4) — New §4A: activation revoke requests (owners request, super admin approves/rejects); direct revoke stays admin-only.
- 2026-10-30 (rev 3) — New §9: desktop settings (global service switches for maintenance, denomination popup, `minimumVersion` / `latestWatcherVersion` / `downloadUrl` / `portalUrl`) and per-machine desktop controls; revoke any activation. Rate limits (429).

- 2026-10-25 (rev 2) — Super admin account (`npm run seed:super-admin`) and access without a subscription: global dashboards, machines, transactions, reports and agent edit/delete now work (G1, G2 fixed). Reports return all CSPs for the admin. IST day boundaries.
- 2026-10-25 (rev 1) — Initial version: auth/BFF guidance, link-request review (CSP + KOs, conflicts), plan pricing, metric definitions, agents directory, blocked global views (G1) and other gaps.
