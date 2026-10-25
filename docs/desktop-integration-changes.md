# Desktop (ReceiptWatcher / CSP Manager) — Required Changes

**Audience:** the engineer/agent implementing changes in the C# desktop repo (`ReceiptWarcher/`).
**Source of truth for the backend:** `csp-manager/apps/api` (Express + Prisma). This doc lists what the desktop must add, modify, or remove to match the backend.
**Last updated:** 2026-10-25 (rev 8)

> Paths below are relative to the desktop project root (`ReceiptWarcher/`). The doc was written against `ReceiptWarcher.zip` (Downloads, 2026-10-24); verify each location against your current checkout before editing.

## How to use this doc

- **Part 1 (items 1–13)** lists what must change in the current desktop code.
- **Part 2 (Desktop API reference, A–J)** is the full contract: every endpoint the desktop calls, where in the app to call it, request validation, the server-side checks in order with their exact error messages, and what the desktop must do for each outcome. When Part 1 and Part 2 disagree, Part 2 wins.

- Each item has a **status**: `READY` (backend is live, desktop can implement), `PENDING` (waiting on a decision or backend work), or `FUTURE` (planned phase).
- Implement `READY` items in order. Do not implement `PENDING` items until this doc marks them `READY`.
- Never block or pause the SBI banking workflow because of an API call. Uploads and syncs are always asynchronous.

## Summary

| # | Area | Status |
|---|---|---|
| 1 | Receipt upload → switch to `/receipts/upload-counts` | READY (implement together with #2) |
| 2 | Cash denomination keys: rename + add ₹5 note, ₹20/₹2/₹1 coins | READY |
| 3 | Money Transfer category mapping | READY |
| 4 | Hard-coded endpoint and config path in `ReceiptUploadService` | READY |
| 5 | Heartbeat response: new plan/feature fields | READY |
| 6 | Heartbeat rejection handling (expired subscription) | READY |
| 7 | Entitlements endpoint (optional on-demand refresh) | READY |
| 8 | Activation: always overwrite ApiKey / MachineCode / AgentId | READY (verify) |
| 9 | Sensitive data in logs | READY |
| 10 | `SaveRawReceipts` defaults | READY |
| 11 | Active machine session required for receipt upload | READY (behaviour to handle) |
| 12 | UI-mode CSP activity session (start / heartbeat / stop) | READY |
| 13 | Renewal / upgrade: no re-activation needed | READY (behaviour) |
| — | **Part 2: Desktop API reference** (all endpoints, validation, logic) | READY |

---

## 1. Receipt upload: switch to the minimal endpoint — READY

UI-mode receipts must go to the **minimal** endpoint. The legacy `/receipts/upload` stays for the background watcher but rejects UI-style records: it requires `amount` > 0 for every receipt (so Balance Enquiry / Mini Statement fail) and ignores `count` and `cashDenomination`.

| | Current | Required |
|---|---|---|
| Endpoint | `POST /api/v1/receipts/upload` (hard-coded `http://localhost:3000`) | `POST /api/v1/receipts/upload-counts` (from config, see #4) |
| `agentId` (top level) | not sent | **required**; must equal the machine's currently assigned agent (`MachineConfig.AgentId`). Mismatch → 403 |
| `status` | sent | remove (server stores `SUCCESS`; only call after the SBI transaction is confirmed) |
| `timestamp` | sent | remove (ignored) |
| `transactionAt` | sent | keep sending (bank transaction time, ISO-8601 UTC). If omitted, the server uses receive time |
| `count` | sent | must be exactly `1` |
| `receipts` array | — | 1–20 receipts per request; split larger outbox batches into chunks of 20 (21+ → 400 "At most 20 receipts per upload.") |
| `amount` | sent | **required** for `CASH_DEPOSIT`, `CASH_WITHDRAWAL`, `MONEY_TRANSFER`; optional otherwise (omit, do not send 0) |
| `cashDenomination` | sent with desktop keys | see #2 |
| customer name / account / raw receipt text | not sent | keep not sending |

**Request**

```json
{
  "machineCode": "MAC-2026-000001",
  "apiKey": "<from MachineConfig>",
  "fingerprint": "<from MachineConfig>",
  "agentId": "<MachineConfig.AgentId>",
  "receipts": [
    {
      "receiptId": "61631801122527224246673224",
      "receiptType": "AEPS",
      "transactionCategory": "CASH_WITHDRAWAL",
      "transactionType": "Cash Withdrawal",
      "rrn": "6163467244324489",
      "location": "RASULPUR BIRITOL BANKI ORISSA 754104",
      "transactionAt": "2026-10-25T10:00:00.000Z",
      "count": 1,
      "amount": 1000,
      "cashDenomination": { "notes500": 1, "notes100": 5 }
    }
  ]
}
```

**Allowed enum values**

- `receiptType`: `AEPS`, `ACCOUNT`, `CARD`, `BBPS`, `MICRO_ATM`, `ACCOUNT_OPENING`, `APY`, `PMJJBY`, `PMSBY`, `MUDRA_LOAN`, `UNKNOWN`
- `transactionCategory`: `CASH_DEPOSIT`, `CASH_WITHDRAWAL`, `MONEY_TRANSFER`, `FUND_TRANSFER`, `BALANCE_ENQUIRY`, `MINI_STATEMENT`, `ACCOUNT_OPENING`, `BBPS`, `MICRO_ATM`, `SOCIAL_SECURITY`, `LOAN`, `OTHER`
- `transactionType`: free text label (e.g. `"Cash Withdrawal"`); used for reporting.

**Ledger effect (server side, for reference):** only `CASH_WITHDRAWAL` (cash out), `CASH_DEPOSIT` (cash in) and `MONEY_TRANSFER` (cash in) affect the float ledger. `FUND_TRANSFER` and all others do not.

**Response (200/201)**

```json
{
  "success": true,
  "message": "Receipt upload completed successfully.",
  "data": {
    "acceptedCount": 1,
    "acceptedRecords": 1,
    "skipped": 0,
    "totalCount": {
      "receiptType": { "AEPS": 15 },
      "transactionCategory": { "CASH_WITHDRAWAL": 10 },
      "transactionType": { "Cash Withdrawal": 10 }
    },
    "acceptedReceipts": [{ "receiptId": "6163...", "count": 1 }],
    "skippedReceipts": []
  }
}
```

**Queue handling**

| Server result | Local queue action |
|---|---|
| receipt in `acceptedReceipts` | mark `Uploaded` |
| receipt in `skippedReceipts` with reason `"Receipt already exists."` | mark `Uploaded` (already on server; duplicate is safe) |
| HTTP 400 (validation) | mark `Failed` with message; do not retry automatically |
| HTTP 403 (agent mismatch, subscription/feature) | keep `Pending`; retry after next successful heartbeat |
| network error / 5xx / timeout | keep `Pending`; retry with bounded exponential backoff + jitter |
| `"No active machine session found."` (400) | keep `Pending`; retry after next heartbeat (see #11) |

Required plan features for this endpoint: `DESKTOP_AUTOMATION` and `RECEIPT_SYNC` (else 403 "Your subscription does not include this feature.").

**Local validation in `Forms/csp/ReceiptUploadService.cs` (`Validate…` ~L243–290):**
- Remove the `Status` required check.
- Require `Count == 1` (currently `>= 1`).
- Extend the amount check to `MONEY_TRANSFER`.
- Denomination total check: keep, after key names are settled (#2).

## 2. Cash denomination keys — rename and add missing — READY

The backend schema is strict and **rejects unknown keys**, so the current desktop object (`note500`, `coin10`, …) fails validation with HTTP 400. Rename every key to the backend name, and add the denominations the desktop is missing.

| Value | Desktop today (`ReceiptUploadService.cs` ~L272) | Required key | Action |
|---|---|---|---|
| ₹500 note | `note500` | `notes500` | rename |
| ₹200 note | `note200` | `notes200` | rename |
| ₹100 note | `note100` | `notes100` | rename |
| ₹50 note | `note50` | `notes50` | rename |
| ₹20 note | `note20` | `notes20` | rename |
| ₹10 note | `note10` | `notes10` | rename |
| ₹5 note | — | `notes5` | **add** |
| ₹20 coin | — | `coins20` | **add** |
| ₹10 coin | `coin10` | `coins10` | rename |
| ₹5 coin | `coin5` | `coins5` | rename |
| ₹2 coin | — | `coins2` | **add** |
| ₹1 coin | — | `coins1` | **add** |

Rules (backend): each value is a non-negative integer ≤ 10,000; omitted keys default to 0. Any other key → 400.

Desktop changes:
- **Controller UI** (`Forms/csp/SbiTransactionControllerForm.cs`, denomination inputs used by Cash Deposit / Cash Withdrawal / Money Transfer): add input fields for ₹5 note, ₹20 coin, ₹2 coin and ₹1 coin, and produce the dictionary with the required keys above. Trace where `controller.CashDenomination` is built and rename the keys there.
- **Local validation** (`ReceiptUploadService.cs` ~L272 `values` map): replace with all 12 required keys and their face values (500, 200, 100, 50, 20, 10, 5, 20, 10, 5, 2, 1). Treat a missing key as 0 instead of throwing. Keep the "total must equal amount" check.
- **Local queue** (`ReceiptUploadQueue.CashDenomination` TEXT column): stores the JSON dictionary. Rows queued with old keys will be rejected by the server. Before upload, map old keys to new keys (`note500`→`notes500`, `coin10`→`coins10`, etc.).

Example:

```json
"cashDenomination": {
  "notes500": 1, "notes200": 1, "notes100": 2, "notes50": 0, "notes20": 0,
  "notes10": 0, "notes5": 0, "coins20": 0, "coins10": 0, "coins5": 0,
  "coins2": 0, "coins1": 0
}
```

(Total ₹900; it must equal `amount`.)

## 3. Money Transfer category mapping — READY

`Forms/csp/SbiTransactionWorkflow.cs` `GetTransactionCategory()` (~L7772) maps only Mini Statement, Cash Deposit and Cash Withdrawal; everything else falls back to `BALANCE_ENQUIRY`. A Money Transfer would be reported as a balance enquiry and skip the ledger.

- Add `"Money Transfer"` → `MONEY_TRANSFER` (and `"Fund Transfer"` → `FUND_TRANSFER` if that flow exists).
- Unknown types should map to `OTHER`, not `BALANCE_ENQUIRY`.
- Confirm the Money Transfer flow actually calls `SaveAndUploadAsync`; the upload in `CSPManagerForm.MoneyTransfer.cs` is currently commented out.

## 4. Hard-coded endpoint and config path — READY

`Forms/csp/ReceiptUploadService.cs`

| | Current | Required |
|---|---|---|
| L35 | `UploadEndpoint = "http://localhost:3000/api/v1/receipts/upload"` | build from config: add `ConfigService.MinimalReceiptEndpoint` |
| L38 | `MachineConfigPath = @"C:\ProgramData\CSP Manager\MachineConfig.json"` | use `AppPaths.MachineConfigFile` |
| `LoadMachineIdentityAsync` | reads machineCode/apiKey/fingerprint | also read `agentId` |

`appsettings.json`: add

```json
"MinimalReceiptEndpoint": "/api/v1/receipts/upload-counts",
"EntitlementsEndpoint": "/api/v1/machines/runtime/entitlements"
```

`ApiBaseUrl` must be HTTPS in production (current sample `http://192.168.1.5:3000` is dev only).

## 5. Heartbeat response — new fields — READY

Endpoint unchanged: `POST /api/v1/machines/runtime/heartbeat`. Existing fields unchanged (old builds keep working). New fields:

```json
"data": {
  "serverTime": "...",
  "heartbeatInterval": 60,
  "heartbeatTimeout": 180,
  "watcherEnabled": true,
  "receiptUploadEnabled": true,
  "subscriptionStatus": "ACTIVE",
  "latestWatcherVersion": "1.0.0",
  "planCode": "CSP_AUTOMATION",
  "subscriptionEndDate": "2026-11-24T18:42:13.000Z",
  "graceEndsAt": null,
  "features": ["DESKTOP_AUTOMATION", "RECEIPT_SYNC"]
}
```

Feature codes: `DESKTOP_AUTOMATION`, `RECEIPT_SYNC`, `CASH_MANAGEMENT`, `MOBILE_TRACKING`.

| File | Change |
|---|---|
| `Models/Api/HeartbeatResponse.cs` → `HeartbeatResponseData` | add `PlanCode` (string), `SubscriptionEndDate` (DateTimeOffset?), `GraceEndsAt` (DateTimeOffset?), `Features` (List<string>) |
| `Models/MachineConfig.cs` | add the same four plus `FeaturesUpdatedAt` (DateTimeOffset?) |
| `Services/HeartbeatService.cs` `ApplyResponse` | copy the new fields, set `FeaturesUpdatedAt = now`, save (already calls `SaveConfig`) |

**Use in UI:** show/hide screens from `MachineConfig.Features` (e.g. cash management only with `CASH_MANAGEMENT`); show "expires on" from `SubscriptionEndDate`.
**This is a UI cache, not authority.** The server re-checks the plan on every protected call. Offline, use the last saved values; never block the SBI flow on them.

## 6. Heartbeat rejection handling — READY

Today, when the server rejects a heartbeat, `HeartbeatService.SendHeartbeat` returns before `ApplyResponse`, so `MachineConfig.SubscriptionStatus` stays `"ACTIVE"` forever.

**Correction (rev 5):** an expired or inactive subscription is rejected by machine authentication with **HTTP 400**, not 403. The messages are `"Subscription is not active."` (after the hourly expiry job) and `"Subscription has expired."` (end date passed, job not run yet). Classify by message, not only by status code; see Part 2, section H.

Required: on a heartbeat rejected with one of the *subscription* messages in section H, set `SubscriptionStatus = "INACTIVE"`, `Features = []`, save, and show a non-blocking "subscription inactive" notice. On *credential* errors, mark the machine as needing re-activation (section H). On network errors / 5xx do **not** change these fields (offline ≠ expired).

## 7. Entitlements endpoint — READY (optional)

`POST /api/v1/machines/runtime/entitlements` with body `{ machineCode, apiKey, fingerprint }` (must be POST). Returns machine, activation, subscription and full feature objects (`code`, `name`, `description`, `category`).

Heartbeat (#5) is the primary source. Use this endpoint only for an on-demand refresh, e.g. a "Refresh plan" button, or right after a protected call returns a feature-related 403. Same caching rule as #5.

## 8. Activation must overwrite credentials — READY (verify)

Backend change: re-activating an already-registered machine (same fingerprint) now issues a **new API key that replaces the old one** and reassigns the machine to the new agent. The old key stops working immediately.

This only applies when the machine has **no current ACTIVE activation of the same owner type** (BC/CSP), e.g. after the activation was revoked or expired. If it still has one, activation fails with 400 `"Machine already has an active CSP subscription."` (or `BC`), and the existing key keeps working.

`Services/ActivationService.cs` currently builds a fresh `MachineConfig` and saves it — this is correct. Verify that nothing else (e.g. the background service holding `ActivationService.Config` in memory) keeps using the old `ApiKey`/`AgentId` after a re-activation; reload config in both UI and service modes.

## 9. Sensitive data in logs — READY

| File | Problem | Fix |
|---|---|---|
| `Services/HttpService.cs` `PostAsync` (~L31) | logs `REQUEST JSON : {json}` including `apiKey` | remove, or log with `apiKey` redacted |
| `Services/HttpService.cs` (~L55, ~L95) | logs full server response and deserialized object | log status code + message only |
| `Forms/csp/ReceiptUploadService.cs` | logs receipt IDs and endpoint | acceptable; never log the request body |

Never log: API key, activation password, SBI credentials, customer name/account, raw receipt text.

## 10. `SaveRawReceipts` defaults — READY

`appsettings.json` `Debug.SaveRawReceipts: true`, `MachineConfig.SaveRawReceipts = true`, and `ActivationService` sets it `true`. Default all to `false` for production builds.

## 11. Active machine session is required for uploads — READY (handle)

`/receipts/upload-counts` needs an ACTIVE machine session, which the server creates/extends on each heartbeat and closes after ~180 s without one. Today only the **background service** sends heartbeats; UI mode does not. If the service is not running, UI uploads fail with `"No active machine session found."`.

With #12 implemented, the UI's activity heartbeat also keeps the machine session alive, so UI uploads work without the background service. Still treat this error as retryable (keep `Pending`): it happens after the CSP logs out and the session times out, and the queued receipt uploads at the next login.

## 12. UI-mode CSP activity session — READY

Tracks "the CSP is logged in to SBI" separately from "the machine/service is alive". Three machine-authenticated endpoints (same `machineCode` / `apiKey` / `fingerprint` as the heartbeat). The existing `POST /machines/runtime/heartbeat` (background service) is unchanged and must keep running as before.

| When | Call | Body (plus machine credentials) |
|---|---|---|
| SBI login workflow begins | `POST /api/v1/machines/runtime/activity/start` | `{ "agentId": "<MachineConfig.AgentId>" }` |
| Every `heartbeatInterval` s (60) while logged in, and **once immediately** after connectivity returns | `POST /api/v1/machines/runtime/activity/heartbeat` | `{ "activitySessionId": "<current id>" }` |
| Explicit SBI logout | `POST /api/v1/machines/runtime/activity/stop` | `{ "activitySessionId": "...", "reason": "LOGOUT" }` |
| Detected SBI auto-logout / session expiry | same | `"reason": "AUTO_LOGOUT"` |
| App close (X / `FormClosing` / shutdown) | same, best effort | `"reason": "APP_CLOSE"` |

**Response (start and heartbeat):**

```json
"data": {
  "activitySessionId": "ACT-2026-000001",
  "startedAt": "2026-10-25T10:00:00.000Z",
  "restarted": false,
  "heartbeatInterval": 60,
  "heartbeatTimeout": 180
}
```

Desktop rules:
- **Always store the `activitySessionId` from the latest response.** If `restarted` is `true`, the previous session timed out (e.g. after an outage) and the server started a new one; use the new id from then on. No extra call is needed.
- **409 on heartbeat** ("Activity session has ended. Start a new activity session.") means the session was stopped or replaced. If the CSP is still logged in, call `start` again; otherwise stop the heartbeat loop.
- **403 on start** means `agentId` doesn't match the machine's current assignment; reload `MachineConfig` (see #8).
- **Offline:** pause sending (don't queue or replay missed heartbeats). On reconnect, send one heartbeat immediately, then resume the 60 s timer.
- **Stop is idempotent:** calling it twice, or for an already-closed session, returns 200. On app close, try it once with a short timeout and don't block closing.
- **Crash / kill / power loss:** nothing to do. The server closes sessions that haven't sent a heartbeat for 180 s, ending them at the last heartbeat.
- Run the timer off the UI thread (e.g. `PeriodicTimer` + `CancellationToken`). Cancel it on logout, auto-logout and `FormClosing`.
- Never log the request body (it contains `apiKey`, see #9).

**Implementation pointers:** the SBI login start, logout and auto-logout detection live in `Forms/csp/CSPManagerForm.cs` / `SbiTransactionWorkflow.cs`. Add a small `CspActivityService` (start/heartbeat/stop + timer) next to `Services/HeartbeatService.cs`, and add `ActivityStartEndpoint`, `ActivityHeartbeatEndpoint` and `ActivityStopEndpoint` to `appsettings.json` / `ConfigService`.

## 13. Renewal / upgrade keeps the machine activated — READY (behaviour)

Backend behaviour:
- **Renewal of the same plan** extends the same subscription from its current end date.
- **Upgrade, or a purchase after the plan ended**, creates a new subscription and moves already-activated machines onto it.

In both cases the machine's `machineCode` and `apiKey` stay valid and **no new activation is needed**. An hourly job marks ended subscriptions `EXPIRED`.

Desktop impact:
- Do not prompt for re-activation after a renewal or upgrade.
- The next successful heartbeat returns the new `planCode`, `subscriptionEndDate` and `features` (#5); refresh the UI from those.
- After an expiry (heartbeat 403, #6), the machine starts working again on the first heartbeat after the CSP pays. Keep retrying heartbeats at the normal interval while the subscription is inactive; do not stop the heartbeat loop.

---

# Part 2 — Desktop API reference

Everything the desktop needs to talk to the backend. Backend paths are under `csp-manager/apps/api/src/modules/`.

## A. Conventions (all endpoints)

- **Base URL:** `ConfigService.ApiBaseUrl` + `/api/v1`. HTTPS in production. Never hard-code hosts.
- **Content type:** `application/json` request and response. All desktop endpoints are `POST`.
- **No user login / JWT on the desktop.** Every runtime call authenticates the *machine* with three body fields: `machineCode`, `apiKey`, `fingerprint` (from `MachineConfig`). Activation is the only call without them.
- **Success envelope:** `{ "success": true, "message": "...", "data": { ... } }`. Status 200 or 201 (both mean success; check `success`).
- **Error envelope:** `{ "success": false, "message": "..." }`. Only one message is returned, even if several fields are invalid. There is no machine-readable error code, so **classify errors by HTTP status + exact `message`** (section H). Keep the message strings in one place in the desktop (e.g. `ApiErrors.cs`).
- **Validation (400):** body is validated before any logic. Strings are trimmed; a required string that is empty after trimming fails. Unknown fields are ignored, except inside `cashDenomination` (unknown keys → 400). Dates are ISO-8601; send UTC with `Z` (e.g. `2026-10-25T10:00:00.000Z`).
- **Timeouts:** 15 s per request (uploads up to 30 s). Never call from the UI thread; never block the SBI workflow on a response.
- **Logging:** never log request bodies (they contain `apiKey` / activation password). Log method, path, status and `message` only.

## B. Lifecycle — which API, from where, when

| Step | Who (process) | Trigger | API | Desktop location |
|---|---|---|---|---|
| 1 | UI | First run / "Activate" screen | `POST /machines/activate` | `Services/ActivationService.cs` |
| 2 | Background service | Service start, then every `heartbeatInterval` s (60) | `POST /machines/runtime/heartbeat` | `Services/HeartbeatService.cs` |
| 3 | UI | SBI login workflow begins | `POST /machines/runtime/activity/start` | new `Services/CspActivityService.cs`, called from `Forms/csp/CSPManagerForm.cs` / `SbiTransactionWorkflow.cs` |
| 4 | UI | Every 60 s while logged in to SBI | `POST /machines/runtime/activity/heartbeat` | `CspActivityService` timer |
| 5 | UI | After each SBI transaction is **confirmed** | enqueue locally, then `POST /receipts/upload-counts` | `Forms/csp/ReceiptUploadService.cs` + `ReceiptUploadQueue` |
| 6 | UI | SBI logout / auto-logout / app close | `POST /machines/runtime/activity/stop` | `CspActivityService` |
| 7 | UI (optional) | "Refresh plan" button, or after a feature 403 | `POST /machines/runtime/entitlements` | `Services/HeartbeatService.cs` or a small `EntitlementService` |

Rules that tie these together:
- **A receipt upload needs an ACTIVE machine session.** The machine heartbeat (step 2) *and* the activity heartbeat (step 4) both create/extend it. A session closes 180 s after the last of either.
- **The activity session (CSP logged in to SBI) is separate** from the machine session. The machine heartbeat never keeps an activity session alive.
- The background service heartbeat must keep running exactly as today, whether or not the UI is open.

## C. `POST /api/v1/machines/activate` — activate this PC

**When:** first install, or after section H says "re-activation required". Called from the activation screen with values the CSP types in (activation code + password are given to them from the web app, `Activations` page).

**Request**

| Field | Type | Rule |
|---|---|---|
| `agentId` | string | required; the agent the activation is assigned to (e.g. `CSP-001`, or a KO id) |
| `activationCode` | string | required; format `XXXX-XXXX-XXXX-XXXX` (16 characters from `A–Z` without `I`/`O` and `2–9`, in groups of 4). Uppercase the input, trim spaces, and send it with the dashes |
| `activationPassword` | string | required; never store or log it |
| `machine.fingerprint` | string | required; stable hardware fingerprint (same value forever on this PC) |
| `machine.watcherVersion` | string | required; app version, e.g. `1.0.0` |
| `machine.machineName`, `osName`, `osVersion`, `deviceName`, `ipAddress` | string | optional |

```json
{
  "agentId": "CSP-001",
  "activationCode": "K7M2-QX9P-RT4W-HB3N",
  "activationPassword": "<typed by user>",
  "machine": {
    "fingerprint": "ABCDEF123456",
    "machineName": "Front desk PC",
    "watcherVersion": "1.0.0",
    "osName": "Windows",
    "osVersion": "10.0.19045",
    "deviceName": "DESKTOP-01",
    "ipAddress": "192.168.1.20"
  }
}
```

**Server checks, in order** (first failure is returned)

| # | Check | Status | Message |
|---|---|---|---|
| 1 | body valid | 400 | first validation issue (500 until backend PR #4 is merged) |
| 2 | agent exists | 404 | `Agent not found.` |
| 3 | agent not deleted / active | 400 | `Agent has been deleted.` / `Agent is inactive.` |
| 4 | activation code exists | 404 | `Activation code not found.` |
| 5 | subscription owner's subscription usable | 403 | `No subscription found. Please purchase or activate a subscription to continue.` / `Your subscription has expired.` / `...suspended.` / `...cancelled.` / `...pending activation.` |
| 6 | activation unused | 400 | `Activation has already been used.` |
| 7 | activation not expired | 400 | `Activation has expired.` |
| 8 | activation assigned to this agent | 400 | `Activation has not been assigned.` / `Activation is not assigned to this agent.` |
| 9 | agent belongs to the subscription owner | 400 | `Agent does not belong to this CSP subscription.` (or `BC`) |
| 10 | password | 400 | `Activation has not been assigned yet.` / `Invalid activation password.` |
| 11 | this PC has no other current active activation of the same owner type | 400 | `Machine already has an active CSP subscription.` (or `BC`) |

**Response (201)**

```json
{ "success": true, "message": "Machine registered and activated successfully.",
  "data": { "machineCode": "MAC-2026-000001", "apiKey": "<64 hex chars>" } }
```

**Desktop logic**
- On success, write a **fresh** `MachineConfig` atomically (temp file + rename): `MachineCode`, `ApiKey`, `Fingerprint`, `AgentId` (= the `agentId` you sent; the response doesn't echo it), `ActivatedAt`. Clear `PlanCode`, `Features`, `SubscriptionStatus`, `SubscriptionEndDate` so stale plan data isn't shown.
- The `apiKey` is shown **only once**. If the write fails, the user must get a new activation code.
- Then tell the background service to reload config (or restart it) and send a heartbeat immediately (section D) to fill plan/features.
- All errors here are user-facing: show `message` on the activation screen. Don't retry automatically.
- Protect the stored key (DPAPI / `ProtectedData` for `ApiKey` in `MachineConfig.json`, or restrict the file ACL to the service account + admins).

## D. `POST /api/v1/machines/runtime/heartbeat` — machine liveness + plan sync

**When:** background service, on start and every `heartbeatInterval` seconds (server says 60). If the service isn't installed/running, the UI's activity heartbeat (section F) keeps the machine session alive while the CSP is logged in.

**Request**

| Field | Type | Rule |
|---|---|---|
| `machineCode`, `apiKey`, `fingerprint` | string | required |
| `watcherVersion` | string | **required** |
| `osName`, `osVersion`, `deviceName`, `ipAddress` | string | optional; send if known |
| `lastStartupAt`, `lastTransactionAt` | ISO date | optional |

**Server checks, in order:** machine credentials (section H, all 400) → activation ACTIVE and not expired (403 `Activation is inactive.` / `Activation has expired.`). Heartbeat does **not** fail when the watcher is disabled; it returns `watcherEnabled: false`.

**Side effects:** creates or extends the machine session (new session if the last heartbeat was >180 s ago); updates machine info and `lastHeartbeatAt`.

**Response (200)**

```json
"data": {
  "serverTime": "2026-10-25T10:00:00.000Z",
  "heartbeatInterval": 60,
  "heartbeatTimeout": 180,
  "watcherEnabled": true,
  "receiptUploadEnabled": true,
  "subscriptionStatus": "ACTIVE",
  "latestWatcherVersion": "1.0.0",
  "planCode": "CSP_AUTOMATION",
  "subscriptionEndDate": "2026-11-24T18:42:13.000Z",
  "graceEndsAt": null,
  "features": ["DESKTOP_AUTOMATION", "RECEIPT_SYNC"]
}
```

**Desktop logic (`HeartbeatService.ApplyResponse`)**
- Save every field into `MachineConfig` plus `LastHeartbeatOkAt = now`, `FeaturesUpdatedAt = now`.
- `heartbeatInterval`: use it as the next delay (clamp to 30–300 s). Don't hard-code 60.
- `watcherEnabled = false`: stop the automation/watcher features and stop uploading; show "disabled by admin". Keep heartbeating (it can be re-enabled from the web).
- `receiptUploadEnabled = false`: keep queuing receipts locally but don't upload. The server doesn't enforce this flag, so the desktop must.
- `latestWatcherVersion` > current version: show a non-blocking "update available".
- `serverTime`: if the PC clock is off by more than 5 min, show a warning. `transactionAt` values come from the PC clock.
- Errors: section H. Never stop the heartbeat loop on an error; on network/5xx errors retry at the normal interval (no tight loops).

## E. `POST /api/v1/machines/runtime/entitlements` — on-demand plan detail (optional)

**Request:** `{ machineCode, apiKey, fingerprint }`.

**Server checks:** machine credentials (400, section H) → machine not deleted, watcher enabled (403 `Receipt Watcher has been disabled for this machine.`) → activation active/not expired (403) → subscription active (403).

**Response (200):** `machine { machineCode, agentId }`, `activation { status, expiresAt }`, `subscription { id, subscriptionNumber, status, subscriptionType, startDate, endDate, graceEndsAt, plan { code, name, ownerType } }`, `features [ { code, name, description, category } ]`.

**Desktop logic:** same caching as the heartbeat. Use for a "Plan details" screen (feature names and descriptions) or right after a feature 403. Don't poll it.

## F. CSP activity session — SBI login tracking

All three need `machineCode`, `apiKey`, `fingerprint`. **Server checks for all three:** machine credentials (400) → machine not deleted, watcher enabled, activation and subscription active (403, section H). **Side effect of start and heartbeat:** also extends the machine session (section B).

### F1. `POST /machines/runtime/activity/start`

- **When:** right when the SBI login workflow begins (before the first transaction).
- **Body:** `+ agentId` (required; `MachineConfig.AgentId`).
- **Checks:** `agentId` must equal the machine's assigned agent → 403 `The supplied agent does not match this machine's assignment.`
- **Logic (server):** closes any open activity session on this machine (`REPLACED`, or `HEARTBEAT_TIMEOUT` if it was stale) and opens a new one.
- **Response (201):** `{ activitySessionId, startedAt, restarted: false, heartbeatInterval, heartbeatTimeout }`.
- **Desktop:** store `activitySessionId` in memory (and in a small state file so a crash-restart can stop it), start the heartbeat timer. If start fails with a network error, retry every 30 s in the background while logged in. **Never block SBI login on it.**

### F2. `POST /machines/runtime/activity/heartbeat`

- **When:** every `heartbeatInterval` s while logged in, plus **once immediately** after connectivity returns.
- **Body:** `+ activitySessionId` (required).
- **Responses:**
  - 200, `restarted: false`: normal.
  - 200, `restarted: true`: the old session timed out (e.g. internet outage > 180 s); the server opened a new one. **Replace the stored id** with the returned `activitySessionId`.
  - 409 `Activity session has ended. Start a new activity session.`: it was stopped or replaced (e.g. another start). If still logged in → call start (F1); else stop the timer.
  - 403 `No agent is currently assigned to this machine.`: machine was unassigned in the web app; stop the timer, show notice.
- **Offline:** skip ticks; don't queue or replay heartbeats.

### F3. `POST /machines/runtime/activity/stop`

- **When / reason:** explicit SBI logout → `LOGOUT`; detected SBI auto-logout / session expiry → `AUTO_LOGOUT`; app close / `FormClosing` / Windows shutdown → `APP_CLOSE`.
- **Body:** `+ activitySessionId`, `reason` (one of the three; anything else → 400).
- **Response (200):** `{ activitySessionId, stopped: true }`. Idempotent: unknown or already-closed ids also return 200.
- **Desktop:** cancel the timer first, then call stop once with a 3 s timeout. On app close don't wait longer and don't retry. If it fails, do nothing: the server closes the session 180 s after the last heartbeat.

## G. `POST /api/v1/receipts/upload-counts` — confirmed transactions

Full field table, enum values and the denomination keys are in items #1 and #2. This section adds the server logic and the desktop queue rules.

**When:** after the SBI transaction is **confirmed successful**. Failed/declined transactions are not uploaded (the server stores everything as `SUCCESS`). Always write the receipt to the local queue first, then upload from the queue (never directly from the workflow).

**Validation (400)**

| Rule | Message (example) |
|---|---|
| `receipts`: 1–20 items | `At most 20 receipts per upload.` |
| `receiptId` non-empty | `Receipt ID is required` |
| `receiptType`, `transactionCategory`: enum values | invalid option |
| `transactionType` non-empty | — |
| `count` must be `1` | — |
| `amount` > 0 when present; **required** for `CASH_DEPOSIT`, `CASH_WITHDRAWAL`, `MONEY_TRANSFER` | `Amount is required for cash and transfer transactions.` |
| `cashDenomination`: only the 12 keys in #2, integers 0–10,000 | unrecognized key |
| `rrn`, `location`: if present, non-empty | — |
| `transactionAt`: ISO date, optional (server uses receive time if missing) | — |

The server does **not** check that the denomination total equals `amount`; the desktop must (item #1).

**Server checks, in order (after validation)**

| # | Check | Status | Message |
|---|---|---|---|
| 1 | machine credentials | 400 | section H |
| 2 | machine not deleted, watcher enabled, activation + subscription active | 403 | section H |
| 3 | machine has an assigned agent | 403 | `No agent is currently assigned to this machine.` |
| 4 | plan has `DESKTOP_AUTOMATION` + `RECEIPT_SYNC` | 403 | `Your subscription does not include this feature.` |
| 5 | body `agentId` = machine's assigned agent | 403 | `The supplied agent does not match this machine's assignment.` |
| 6 | that agent is a non-deleted **CSP or KO** | 400 | `The assigned agent is not valid.` |
| 7 | machine session ACTIVE | 400 | `No active machine session found.` |

Per receipt, inside one DB transaction: duplicate id in the same request → skipped `Duplicate receipt in request.`; `receiptId` already on the server (**unique across all machines**) → skipped `Receipt already exists.`; else saved with its denomination, and a float-ledger entry is written for cash/transfer categories. If anything throws, **nothing** from that request is saved, so the whole chunk can be retried safely.

**Desktop queue rules**

| Result | Queue action |
|---|---|
| in `acceptedReceipts` | `Uploaded` |
| in `skippedReceipts` (either reason) | `Uploaded` (it's on the server) |
| 400 validation message | `Failed` + message; no auto-retry; show in an "upload problems" list |
| 400 `No active machine session found.` | `Pending`; retry after the next successful heartbeat |
| 400 `The assigned agent is not valid.` | `Pending`; show notice (agent deleted in the web app) |
| 400 credential messages (section H) | `Pending`; stop uploading until re-activated |
| 400 subscription messages / 403 | `Pending`; retry after a heartbeat shows the subscription/feature is back |
| network / timeout / 5xx | `Pending`; retry with backoff 30 s → 1 → 2 → 5 → 10 min (max), with jitter |

- Upload in chunks of ≤ 20, oldest first, one request at a time (no parallel uploads).
- Trigger: after enqueue, after each successful heartbeat, and on a 60 s timer when `Pending` rows exist.
- Before uploading old queued rows, map legacy denomination keys (#2) and drop rows older than 30 days to `Failed` ("too old") so a broken row can't loop forever.
- `totalCount` in the response = the agent's cumulative counts on the server; use it for the on-screen counters (don't add locally).

## H. Error classification (all runtime endpoints)

Machine authentication runs first on every runtime call and returns **400** for all of these:

| Message | Meaning | Desktop action |
|---|---|---|
| `Machine not found.` | machine code unknown | **Re-activation required.** Stop runtime calls, show activation screen |
| `Machine has no active activation.` | activation released/revoked | **Re-activation required** |
| `Machine API key not found.` / `Invalid API key.` | key replaced (re-activated elsewhere) or corrupted | **Re-activation required.** First reload `MachineConfig` from disk once and retry (the service may hold an old key, item #8) |
| `Machine fingerprint mismatch.` | config copied to another PC, or fingerprint algorithm changed | **Re-activation required** |
| `Machine is not active.` | disabled by admin | Show "machine disabled"; keep heartbeating every interval |
| `Subscription is not active.` / `Subscription has expired.` | plan ended | **Subscription inactive** (item #6): `SubscriptionStatus = "INACTIVE"`, `Features = []`, notice; keep heartbeating |

Then (403):

| Message | Desktop action |
|---|---|
| `Machine has been deleted.` | Re-activation required |
| `Receipt Watcher has been disabled for this machine.` | Same as `watcherEnabled = false` (section D) |
| `Activation is inactive.` / `Activation has expired.` | Re-activation required |
| `Subscription is inactive or expired.` | Subscription inactive |
| `Your subscription does not include this feature.` | Refresh features (heartbeat/entitlements); hide the feature |
| `The supplied agent does not match this machine's assignment.` | Reload `MachineConfig`; if still different, the machine was reassigned in the web app: show notice, require re-activation for the new agent |
| `No agent is currently assigned to this machine.` | Show notice; stop activity and uploads |

Other: **409** (activity only, F2). **5xx / network / timeout:** temporary; retry per endpoint rules, change no state.

"Re-activation required" = set `MachineConfig.NeedsActivation = true`, stop the heartbeat/activity/upload loops (keep the local queue), and show the activation screen on next UI open. Receipts queued before re-activation upload afterwards (with the new `AgentId`).

## I. Plan → feature → desktop UI

| Plan (`planCode`) | Price | Features |
|---|---|---|
| `CSP_AUTOMATION` | ₹250 | `DESKTOP_AUTOMATION`, `RECEIPT_SYNC` |
| `CSP_AUTOMATION_CASH_MANAGEMENT` | ₹450 | + `CASH_MANAGEMENT` |
| `CSP_COMPLETE` | ₹550 | + `CASH_MANAGEMENT`, `MOBILE_TRACKING` |
| `BC_BASIC` / `BC_PRO` | ₹199 / ₹399 | `DESKTOP_AUTOMATION`, `RECEIPT_SYNC`, `CASH_MANAGEMENT`, `MOBILE_TRACKING` (plans differ by machine limit) |
| `BC_CSP_LINK` | ₹799 | `CSP_LINKING`, `CASH_MANAGEMENT`; **no machines**, so no desktop activations exist on this plan |

| Feature | Desktop behaviour |
|---|---|
| `DESKTOP_AUTOMATION` | SBI automation / controller workflow enabled |
| `RECEIPT_SYNC` | upload-counts allowed (needs `DESKTOP_AUTOMATION` too) |
| `CASH_MANAGEMENT` | show cash/float screens and the denomination inputs. Without it: hide them and omit `cashDenomination` (`amount` is still required for cash/transfer categories) |
| `MOBILE_TRACKING` | not used by the desktop |
| `CSP_LINKING` | web only (BC links CSPs); not used by the desktop |

Always read features from `MachineConfig.Features` (last heartbeat). Offline, use the cached list. It's a UI hint only; the server re-checks on every call.

## J. Known backend gaps (desktop: handle as described, backend will change)

| Gap | Effect today | Desktop handling |
|---|---|---|
| `receiptUploadEnabled` not enforced on the server | — | desktop must respect it (section D) |
| `/machines/activate` returns 500 for a malformed body | until backend PR #4 merges | validate locally before sending |

---

## Changelog

- 2026-10-25 (rev 8) — §C: activation code format is `XXXX-XXXX-XXXX-XXXX` (was described as 16 plain characters). A CSP plan can now cover several machines; each machine still activates with its own code, so nothing changes on the desktop.
- 2026-10-25 (rev 7) — Section I: BC plans now list explicit features; added the ₹799 `BC_CSP_LINK` plan (no machines) and the `CSP_LINKING` feature.
- 2026-10-25 (rev 6) — Backend fixes: `upload-counts` accepts machines assigned to a **KO** (message now `The assigned agent is not valid.`); BC plans report all features in heartbeat/entitlements and pass the upload feature check; legacy `/receipts/upload` returns 400/403 instead of 500 for "no active session" / "no agent". Section J trimmed accordingly.
- 2026-10-25 (rev 5) — Added Part 2: full desktop API reference (A–J). Corrected #6 (expired subscription is 400 from machine auth, not 403) and #8 (re-activation refused while an active activation of the same owner type exists).
- 2026-10-25 — Initial version: items 1–12.
- 2026-10-25 (rev 4) — #12 now READY: activity start/heartbeat/stop contract; #11 updated (UI activity heartbeat keeps the machine session alive).
- 2026-10-25 (rev 3b) — #1: `upload-counts` accepts at most 20 receipts per request.
- 2026-10-25 (rev 3) — Added #13: renewal/upgrade keep the machine activated; no re-activation prompt.
- 2026-10-25 (rev 2) — #2 now READY: backend added `notes200`; desktop must rename all keys to the backend names and add ₹5 note, ₹20/₹2/₹1 coin inputs.
