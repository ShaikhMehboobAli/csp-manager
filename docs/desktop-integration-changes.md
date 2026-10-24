# Desktop (ReceiptWatcher / CSP Manager) — Required Changes

**Audience:** the engineer/agent implementing changes in the C# desktop repo (`ReceiptWarcher/`).
**Source of truth for the backend:** `csp-manager/apps/api` (Express + Prisma). This doc lists what the desktop must add, modify, or remove to match the backend.
**Last updated:** 2026-10-25 (rev 4)

> Paths below are relative to the desktop project root (`ReceiptWarcher/`). The doc was written against `ReceiptWarcher.zip` (Downloads, 2026-10-24); verify each location against your current checkout before editing.

## How to use this doc

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

Today, when the server rejects a heartbeat (e.g. 403 "Subscription is inactive or expired."), `HeartbeatService.SendHeartbeat` returns before `ApplyResponse`, so `MachineConfig.SubscriptionStatus` stays `"ACTIVE"` forever.

Required: when the heartbeat returns HTTP 403 with `success: false`, set `SubscriptionStatus = "INACTIVE"`, `Features = []`, save, and show a non-blocking "subscription inactive" notice. On network errors do **not** change these fields (offline ≠ expired).

## 7. Entitlements endpoint — READY (optional)

`POST /api/v1/machines/runtime/entitlements` with body `{ machineCode, apiKey, fingerprint }` (must be POST). Returns machine, activation, subscription and full feature objects (`code`, `name`, `description`, `category`).

Heartbeat (#5) is the primary source. Use this endpoint only for an on-demand refresh, e.g. a "Refresh plan" button, or right after a protected call returns a feature-related 403. Same caching rule as #5.

## 8. Activation must overwrite credentials — READY (verify)

Backend change: re-activating an already-registered machine (same fingerprint) now issues a **new API key that replaces the old one** and reassigns the machine to the new agent. The old key stops working immediately.

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

## Changelog

- 2026-10-25 — Initial version: items 1–12.
- 2026-10-25 (rev 4) — #12 now READY: activity start/heartbeat/stop contract; #11 updated (UI activity heartbeat keeps the machine session alive).
- 2026-10-25 (rev 3b) — #1: `upload-counts` accepts at most 20 receipts per request.
- 2026-10-25 (rev 3) — Added #13: renewal/upgrade keep the machine activated; no re-activation prompt.
- 2026-10-25 (rev 2) — #2 now READY: backend added `notes200`; desktop must rename all keys to the backend names and add ₹5 note, ₹20/₹2/₹1 coin inputs.
