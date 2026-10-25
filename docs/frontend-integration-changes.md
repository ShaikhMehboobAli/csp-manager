# Web Frontend — Required Changes

**Audience:** the engineer/agent building the CSP Manager web app (BC, CSP and Super Admin screens).
**Source of truth for the backend:** `csp-manager/apps/api` (Express + Prisma). This doc lists the backend changes the web app must support, with the exact endpoints, request/response shapes and error messages.
**Last updated:** 2026-10-25 (rev 1)

## How to use this doc

- Each item has a **status**: `READY` (backend is live, frontend can implement), `PENDING` (waiting on a decision or backend work), or `FUTURE` (planned).
- All endpoints are under `/api/v1` and need `Authorization: Bearer <accessToken>` unless marked public.
- Success responses: `{ "success": true, "message": "...", "data": ... }`. Errors: `{ "success": false, "message": "..." }` (one message). Show `message` to the user; the strings below are exact.
- Roles: `SUPER_ADMIN`, `BC_ADMIN`, `CSP_ADMIN`. A role that may not call an endpoint gets 403 `You do not have permission to access this resource.`

## Summary

| # | Area | Who | Status |
|---|---|---|---|
| 1 | New BC ₹799 plan (`BC_CSP_LINK`) in plan lists and checkout | BC | READY |
| 2 | Link a subscribed CSP: search + request (BC) | BC | READY |
| 3 | Link requests list / detail / cancel (BC) | BC | READY |
| 4 | Link request review: approve / reject, conflict flag (Super Admin) | Super Admin | READY |
| 5 | `POST /agents/csp` with an existing CSP now returns 202 (pending approval) | BC | READY (breaking) |
| 6 | Plan pricing management (Super Admin) | Super Admin | READY |
| 7 | Linked CSP data on BC dashboards / reports | BC | READY (behaviour) |
| 8 | CSP-side approval of link requests | CSP | FUTURE |

---

## 1. BC ₹799 plan — READY

`GET /subscriptions/plans?ownerType=BC` (public) now returns three BC plans:

| `code` | Name | `machineLimit` | Pricing (initial, Super Admin can change) | Features |
|---|---|---|---|---|
| `BC_BASIC` | BC Basic | 1 | MONTHLY ₹199 | `DESKTOP_AUTOMATION`, `RECEIPT_SYNC`, `CASH_MANAGEMENT`, `MOBILE_TRACKING` |
| `BC_PRO` | BC Professional | 5 | MONTHLY ₹399 | same |
| `BC_CSP_LINK` | BC CSP Link | **0** | MONTHLY ₹799, HALF_YEARLY ₹4794, YEARLY ₹9588 | `CSP_LINKING`, `CASH_MANAGEMENT` |

Plan shape (unchanged): `{ id, code, name, ownerType, level, machineLimit, pricing: [{ billingCycle, durationDays, price }], features: [{ code, name, description, category }] }`. `price` is a string.

**UI**
- Plan cards: show every entry in `pricing` (billing-cycle selector). Don't hard-code prices; they come from the API.
- `BC_CSP_LINK`: show "No machine activations. Link your existing subscribed CSPs and view their data." Hide machine-count text when `machineLimit` is 0.
- Checkout is unchanged: `POST /payments/create-order { planId, billingCycle }` → `POST /payments/verify`.
- A BC on `BC_CSP_LINK` gets **no activation codes**: on the Activations page show an empty state ("This plan doesn't include machine activations") instead of an error. Switching from `BC_BASIC`/`BC_PRO` to `BC_CSP_LINK` ends the old plan immediately and its machines stop working; warn the BC on the confirm screen.
- Show the "Link CSP" menu (items 2–3) only when the BC's current plan has the `CSP_LINKING` feature (`GET /subscriptions/current` → plan, or the plan list).

## 2. Link a subscribed CSP — READY (BC)

### 2a. Search

`GET /bc-links/csps/search?search=<text>` — `BC_ADMIN`.

- `search`: at least 2 characters (else 400 `Enter at least 2 characters to search.`). Matches CSP agent ID or name, case-insensitive. Max 20 results.
- Only CSPs with an **active CSP subscription** are returned.

```json
"data": [
  { "agentId": "CSP-TEST-003", "name": "Test CSP", "address": "…", "linkStatus": "NOT_LINKED", "hasPendingRequest": false }
]
```

`linkStatus`: `NOT_LINKED` | `LINKED` (already yours) | `LINKED_TO_OTHER_BC`.

**UI:** debounce input (300 ms). Per row:
- `LINKED` → badge "Linked", no button.
- `hasPendingRequest` → badge "Request pending", no button.
- `NOT_LINKED` → "Send link request".
- `LINKED_TO_OTHER_BC` → "Send link request" with a note "This CSP is linked to another BC; the admin will review it."

Errors: 403 `Your subscription does not include this feature.` (plan without `CSP_LINKING`), 403 subscription messages (`Your subscription has expired.`, `No subscription found. ...`). Show an upgrade prompt for these.

### 2b. Send request

`POST /bc-links/requests` — `BC_ADMIN`.

```json
{ "cspAgentId": "CSP-TEST-003", "remarks": "optional, max 500 chars" }
```

**201** `Link request submitted for admin approval.` — or, when the CSP is linked to another BC, `Link request submitted. The CSP is linked to another BC, so an admin will review it.` (`data.isConflict = true`). `data` is a link request (item 3).

| Status | Message | UI |
|---|---|---|
| 404 | `CSP not found.` | field error |
| 400 | `This CSP does not have an active subscription.` | field error |
| 400 | `CSP is already linked with this Business Correspondent.` | refresh search row |
| 409 | `A link request for this CSP is already pending.` | show pending badge |
| 400 | `Invalid input: expected string, received undefined` | `cspAgentId` missing |
| 403 | feature / subscription messages | upgrade prompt |

## 3. Link requests (BC) — READY

**Link request object** (all request endpoints):

```json
{
  "id": "cm…", "requestNumber": "LNK-2026-000001", "status": "PENDING",
  "bcId": "BC0001", "bcName": "…",
  "cspAgentId": "CSP-TEST-003", "cspName": "…",
  "isConflict": false,
  "linkType": "SUBSCRIBED_CSP",
  "currentBcId": null, "cspCurrentBcId": null,
  "remarks": "…", "reviewRemarks": null, "reviewedAt": null,
  "createdAt": "…", "updatedAt": "…"
}
```

- `status`: `PENDING` | `APPROVED` | `REJECTED` | `CANCELLED`.
- `linkType`: `SUBSCRIBED_CSP` (₹799 link: the BC sees the CSP's data only while the CSP's own plan is active) or `BC_MANAGED` (legacy link from `POST /agents/csp`, item 5).
- `currentBcId` / `cspCurrentBcId` are always `null` for a BC (which other BC owns the CSP is admin-only).

| Endpoint | Role | Notes |
|---|---|---|
| `GET /bc-links/requests?page=&limit=&status=&isConflict=&cspAgentId=` | BC (own), Super Admin (all) | `data: { items, pagination: { page, limit, total, totalPages } }`; `limit` ≤ 100, default 20 |
| `GET /bc-links/requests/:id` | BC (own), Super Admin | another BC's request → 404 `Link request not found.` |
| `POST /bc-links/requests/:id/cancel` | BC (own) | only `PENDING`; else 409 `Only pending requests can be cancelled.` |

**UI (BC "Link requests" page):** table with request number, CSP, status chip, conflict chip, created date, review remarks; status filter tabs; "Cancel" on pending rows (with confirmation).

## 4. Link request review — READY (Super Admin)

| Endpoint | Body | Result |
|---|---|---|
| `GET /bc-links/requests?status=PENDING&isConflict=true&bcId=&cspAgentId=` | — | filters; `bcId` is honoured for Super Admin only |
| `POST /bc-links/requests/:id/approve` | `{ "remarks"?: string }` (body optional) | `Link request approved. The CSP is now linked to the BC.` |
| `POST /bc-links/requests/:id/reject` | `{ "remarks"?: string }` (body optional) | `Link request rejected.` |

Errors: 409 `This request has already been reviewed.`; 400 `The CSP is no longer active.`; 400 `The BC does not have an active CSP linking plan.` (`SUBSCRIBED_CSP` requests only).

**Conflict handling (`isConflict: true`)** — the CSP is (or was, when requested) linked to another BC:
- Show a warning banner on the row/detail: "CSP is linked to `currentBcId`" (the BC it belonged to when the request was raised) and "Currently linked to `cspCurrentBcId`".
- **Approve moves the CSP** (and its KOs) to the requesting BC; the previous BC loses its data immediately. Ask for confirmation, and make remarks required in the UI for conflict approvals.
- When one request for a CSP is approved, other pending requests for the same CSP become conflicts automatically.

**UI (Admin "BC link requests" page):** default filter `PENDING`, a "Conflicts" tab (`isConflict=true`), detail drawer with BC, CSP, link type, remarks, approve/reject with remarks.

## 5. `POST /agents/csp` with an existing CSP → 202 — READY (breaking)

Linking an **existing** CSP to a BC now always needs Super Admin approval, in the old flow too.

| Case | Before | Now |
|---|---|---|
| BC creates a **new** CSP (agent ID doesn't exist) | 201, linked | **unchanged**: 201 `CSP created successfully.`, `data: { csp, kos }` |
| BC enters an **existing, unlinked** CSP | 201, linked immediately | **202** `This CSP already exists. A link request was sent to the admin for approval.` |
| BC enters a CSP **linked to another BC** | 400 `CSP is already linked with another Business Correspondent.` | **202** `This CSP is linked to another BC. A link request was sent to the admin for review.` (`isConflict: true`) |
| CSP already linked to this BC | 400 | unchanged: 400 `CSP is already linked with this Business Correspondent.` |
| Existing CSP **plus `kos`** in the body | KOs created | 400 `Add KOs after the CSP link is approved.` |
| Super Admin calls it | — | unchanged (links directly) |

202 body: `data: { "csp": null, "kos": [], "linkRequest": { …link request object… } }`. The request's `linkType` is `SUBSCRIBED_CSP` if the BC's plan has `CSP_LINKING`, else `BC_MANAGED`.

**UI (Add CSP form):**
- Handle **202 separately from 201**: don't navigate to a CSP page (`csp` is `null`); show a success toast with the message and link to the BC's "Link requests" page.
- If the BC has filled KO rows for an existing CSP, show the 400 message and keep the form.
- Optional: call `GET /bc-links/csps/search` (₹799 BCs) or check the agent ID first to tell the user up front that approval will be needed.

## 6. Plan pricing management — READY (Super Admin)

`PATCH /subscriptions/plans/:planId/pricing` — `SUPER_ADMIN`.

```json
{ "billingCycle": "YEARLY", "price": 9588, "durationDays": 365, "isActive": true }
```

- `billingCycle`: `MONTHLY` | `QUARTERLY` | `HALF_YEARLY` | `YEARLY`.
- `price`: > 0, ≤ 1,000,000.
- `durationDays`: 1–3660; **required only when adding a cycle the plan doesn't have yet** (else 400 `durationDays is required for a new billing cycle.`).
- `isActive`: optional; `false` hides the cycle from plan lists and checkout.

Response: `data: { planId, planCode, billingCycle, durationDays, price, isActive }`. Errors: 404 `Plan not found.`, 400 validation.

New prices apply to new purchases and renewals; running subscriptions keep what they paid. Seeding never overwrites prices set here.

**UI (Admin "Plans & pricing"):** list plans from `GET /subscriptions/plans?ownerType=BC|CSP`, editable price per cycle, toggle active, "Add billing cycle" (asks for duration days). Note: the public plan list returns only **active** cycles, so an inactive cycle disappears from it after saving; keep it in local state or re-add it via this endpoint.

## 7. Linked CSP data for the BC — READY (behaviour)

After approval, the CSP (and its KOs) are part of the BC's data on every BC screen: dashboard summary and CSP summary, CSP monthly detail, machines, receipts, reports, ledger/float (BCs always see float and cash figures).

- `SUBSCRIBED_CSP` links: when the CSP's own subscription lapses, the CSP **disappears from the BC's data** but stays linked; it reappears when the CSP renews. Opening that CSP's detail page meanwhile returns 403/404; show "This CSP's subscription is inactive" and refresh the list.
- `BC_MANAGED` links: always visible while linked.
- No new endpoints; existing BC screens just include more CSPs.

## 8. CSP-side approval — FUTURE

Later, a CSP will be able to approve link requests for itself. Not available yet; only Super Admin reviews. Don't build CSP screens for it.

---

## Changelog

- 2026-10-25 (rev 1) — Initial version: BC ₹799 plan, CSP link requests, admin review with conflict flag, `POST /agents/csp` 202 for existing CSPs, plan pricing management.
