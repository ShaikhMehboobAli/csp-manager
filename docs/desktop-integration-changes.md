# Desktop (ReceiptWatcher / CSP Manager) — Required Changes

**Audience:** the engineer/agent implementing changes in the C# desktop repo (`ReceiptWarcher/`).
**Source of truth for the backend:** `csp-manager/apps/api` (Express + Prisma). This doc lists what the desktop must add, modify, or remove to match the backend.
**Last updated:** 2026-11-08 (rev 29)

> **Rev 29 (2026-11-08): your asks 7–11 (desktop README, 2026-11-08) are built — items #35–#39.** #35 cash receipts without notes ("Count needed": `denominationPending`, `GET` / `POST /machines/runtime/cash/receipt-counts`, heartbeat `cash.pendingCounts`), #36 close the day with cash in account (`countedCashInAccount`), #37 SBI kiosk user id (`sbiUserId` in `accessAgents`, `activity/start` accepts it), #38 receipt `source`, #39 diagnostics log upload (heartbeat `diagnostics`, `POST /machines/runtime/diagnostics`). Each item says what is exactly as you asked and what differs.

> **Rev 28 (2026-11-08): read #34** — one checklist of every API change in rev 26–27 (renewal blocking, free trial) for the desktop: request / response, success and failure handling, and where in the app to handle each. Sections C, D and Q2 now include the trial fields and refusals.

> **Rev 27 (2026-11-07):** item #33 **free trial**: heartbeat `subscriptionType` / `isTrial` (show a trial banner), activation refusals `TRIAL_ALREADY_USED_ON_MACHINE` / `TRIAL_ALREADY_USED` (one trial per PC and per agent ID); keep the fingerprint stable.

> **Rev 26 (2026-11-07):** a CSP plan is now **blocked from its end date until the renewal charge succeeds** (no working during the retries, no grace period for CSP plans) — 25.2 updated. Nothing new to call; the existing `SUBSCRIPTION_EXPIRED` handling covers it.

> **Rev 25 (2026-11-07): items #25–#32 are new — read them first.** Plan blocking screens (#25), shared PCs with automatic cash login after the SBI kiosk login + email OTP fallback (#26), activation form pre-fill / difference source / KO email (#27), mandatory Adjust requests and a one-step cash transfer (#28), failed receipts skipped (#29), automation fixes from testing (#30), ₹450 plan removed (#31), KO replaced / deleted (#32).

> Paths below are relative to the desktop project root (`ReceiptWarcher/`). The doc was written against `ReceiptWarcher.zip` (Downloads, 2026-10-24); verify each location against your current checkout before editing.

### UI wording (owner's terms, 2026-11-08)

The owner renamed the user-facing terms in the mobile app; the desktop should show the same words so a CSP and its operators see one vocabulary on the PC and on the phone. This doc keeps the API words because they are the field and code names; translate them only in the desktop UI.

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

On the desktop that means: the activation and login screens ask for the **KO ID** (CSP) or **Sub KO ID** (an operator); the cash panel shows **Cash holding** for cash in account and **Current A/c** for money in a settlement step and left in bank; settlement directions read "Holding → Hand" / "Hand → Holding"; prompts like "Ask your CSP to renew" become "Ask your KO to renew".

## How to use this doc

- **Part 1 (items 1–13)** lists what must change in the current desktop code.
- **Part 3 (Endpoint quick reference, at the end)** lists every endpoint the desktop calls with URL, request, response and how to use it. Start there.
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
| 14 | `receiptWatcherAllowed`: server decides if the background watcher may run | READY |
| 15 | Re-activation of the same PC after a format; revoke in the web app | READY |
| 16 | Passbook printing + social security receipt values; per-agent `receiptId`; per-receipt validation | READY |
| 17 | `desktopControls`: admin switches for services and the denomination popup | READY |
| 18 | Versions (`minimumVersion`, `downloadUrl`), `portalUrl`, removed endpoints, rate limits | READY |
| 19 | Machine credentials: HTTPS, DPAPI, header credentials, **signed requests with a device key** | READY (must ship before production) |
| 21 | Cash management: `cash` in the heartbeat (check before each transaction), `cash` result per uploaded receipt, cash count at activation, today's cash screen, KO settlements, change requests | READY (build the cash screen + pre-check) |
| 22 | Cash management extras (your requirements doc item 6; **rev 21: your 6.8 answered in 22.9**: due `cashSide`, error `code`s, `Idempotency-Key`, settlement request fields, heartbeat waiting items, default labels, speed): labels + custom transactions, balance due, cash exchange, close the day, history, tasks; "other cash"; server plan check; activation count saved before setup | READY (read 22.0 first: ⚠ differences) |
| 23 | Optional receipt fields chosen by the super admin (`receiptFields.allowed` in heartbeat + entitlements → machineConfig); heartbeat timeout now 120 s (one missed heartbeat); commission is computed by the server | READY |
| 24 | **Rev 24:** receipt **slip image** upload (when the super admin selects `slip`), the four default receipt fields are fixed, the **grace period** keeps the PC working after the end date | READY |
| 25 | **Rev 25: plan blocking.** Lapsed / expired / cancelled-and-ended subscription → replace the automation UI and the cash management UI with the "Please ask your CSP to renew…" screen + plan list button; ₹250 plan → no cash management | READY |
| 26 | **Rev 25: shared PCs.** Any agent of the owner CSP (CSP + its KOs) may use any PC of the family; cash management follows the SBI kiosk login (fingerprint) automatically; email OTP login as fallback; `accessAgent` in machineConfig | READY |
| 27 | **Rev 25: activation form**: pre-fill the KO's cash in hand from the server, `differenceSource` (cash in account / other) when the count differs, KO email OTP verification; one activation per agent | READY |
| 28 | **Rev 25: mandatory Adjust requests** (CSP changed the agent's cash in hand in the app → count the notes) and a **one-step** cash in hand ⇄ cash in account transfer (simplified flow) | READY |
| 29 | **Rev 25: failed receipts**: never send a receipt SBI shows as failed; send `status`; `agentId` = the agent logged in to SBI | READY |
| 30 | **Rev 25: automation fixes from testing** (AEPS proceed buttons, GPS device selection, red field errors, failed receipt page, print preferences, recent transactions filter, money transfer to a linked current account, Peri / Morpho service restart) | READY (30.8 PENDING details) |
| 31 | **Rev 25: plans**: ₹450 `CSP_AUTOMATION_CASH_MANAGEMENT` removed; cash management only on ₹550 `CSP_COMPLETE` | READY |
| 32 | **Rev 25: KO replaced / deleted**: the PC's agent can change under you | READY |
| 33 | **Rev 27: free trial**: trial banner from heartbeat `isTrial`; activation refused for a PC / agent ID that already had another account's trial | READY |
| 34 | **Rev 28: API change checklist** for rev 26–27 (what changed, success / failure handling, where) | READY |
| 35 | **Rev 29 (your ask 7): cash receipts without notes** — "Count needed" list and fill, heartbeat `cash.pendingCounts` | READY |
| 36 | **Rev 29 (your ask 8): close the day with cash in account** (`countedCashInAccount`, `accountDifference`) | READY |
| 37 | **Rev 29 (your ask 9): SBI kiosk user id** (`sbiUserId` in `accessAgents`; `activity/start` matches it) | READY |
| 38 | **Rev 29 (your ask 10): receipt `source`** (`AUTOMATION` / `MANUAL`) | READY |
| 39 | **Rev 29 (your ask 11): diagnostics log upload** on request (heartbeat `diagnostics`, `POST /machines/runtime/diagnostics`) | READY |
| 20 | Receipts older than the retention period (default 60 days, at least 15) are refused on upload; `totalCount` covers the last 12 months | READY (handle the new skip reason) |
| — | **Part 3: Endpoint quick reference** (URL, request, response, how to use) | READY |
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
  "heartbeatTimeout": 120,
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

`/receipts/upload-counts` needs an ACTIVE machine session, which the server creates/extends on each heartbeat and closes after ~120 s without one. Today only the **background service** sends heartbeats; UI mode does not. If the service is not running, UI uploads fail with `"No active machine session found."`.

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
  "heartbeatTimeout": 120
}
```

Desktop rules:
- **Always store the `activitySessionId` from the latest response.** If `restarted` is `true`, the previous session timed out (e.g. after an outage) and the server started a new one; use the new id from then on. No extra call is needed.
- **409 on heartbeat** ("Activity session has ended. Start a new activity session.") means the session was stopped or replaced. If the CSP is still logged in, call `start` again; otherwise stop the heartbeat loop.
- **403 on start** means `agentId` doesn't match the machine's current assignment; reload `MachineConfig` (see #8).
- **Offline:** pause sending (don't queue or replay missed heartbeats). On reconnect, send one heartbeat immediately, then resume the 60 s timer.
- **Stop is idempotent:** calling it twice, or for an already-closed session, returns 200. On app close, try it once with a short timeout and don't block closing.
- **Crash / kill / power loss:** nothing to do. The server closes sessions that haven't sent a heartbeat for 120 s, ending them at the last heartbeat.
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

## 14. Receipt watcher: follow `receiptWatcherAllowed` — READY

Heartbeat **and** entitlements `data` now carry:

```json
"receiptWatcherAllowed": false,
"receiptWatcherReason": "CSP_PLAN"
```

| `receiptWatcherReason` | `receiptWatcherAllowed` | Meaning |
|---|---|---|
| `BC_PLAN` | `true` | PC activated under a BC plan (`BC_BASIC` / `BC_PRO`) and the CSP it works for has no subscription of its own |
| `CSP_SUBSCRIPTION` | `false` | PC activated under a BC plan, but the CSP (the agent itself, or a KO's parent CSP) now has its own ACTIVE subscription (or is within grace) |
| `CSP_PLAN` | `false` | PC activated under a CSP plan |

- The field overrides the owner-type rule in `Services/ReceiptSourcePolicy.cs`. Field missing (older server): keep the owner-type rule.
- Cache it in `MachineConfig` with the other plan fields; offline, use the last value. The service reads it from its heartbeat, so a change applies within one interval (60 s).
- The server enforces it too: `POST /receipts/upload` returns **403** `Receipt watcher is not allowed for this machine. Receipts are counted by CSP Manager.` when the value is `false`. Treat it like `receiptWatcherAllowed = false`: stop the watcher and keep the queue.
- Heartbeat `data` also has `ownerType` (`BC` / `CSP`), so the service no longer needs the plan-list lookup.

**`POST /api/v1/receipts/upload` (watcher full upload) contract.** It exists and is unchanged apart from the watcher check and a 20-receipt limit:

```json
{
  "machineCode": "MAC-...", "apiKey": "...", "fingerprint": "...",
  "receipts": [
    { "receiptId": "required", "receiptType": "enum", "transactionCategory": "enum",
      "transactionType": "required", "status": "SUCCESS | FAILED | ...",
      "transactionAt": "ISO date, required", "amount": 100,
      "charges": 0, "stan": "", "rrn": "", "terminalId": "",
      "customerName": "", "customerAccount": "", "location": "" }
  ]
}
```

- `status`, `transactionAt` and `amount` (> 0) are **required on every receipt**; the rest are optional. No `agentId`: the machine's assigned agent is used.
- 1–20 receipts per request. Validation is for the whole request here (one bad receipt → 400).
- Needs an active machine session (send a heartbeat first). Response: `data { total, uploaded, skipped, uploadedReceipts, skippedReceipts }`; duplicates for the same agent are skipped with `Receipt already exists.`

## 15. Formatted PC: re-activate with the same code; revoke in the web app — READY

**Re-activation (same PC).** `POST /machines/activate` with the code this PC already used, the same `fingerprint`, the correct password and the same agent (the assigned agent or the machine's current agent) now returns **201** `{ machineCode, apiKey }` with message `Machine re-activated successfully. The previous API key no longer works.`
- Same `machineCode`, same activation, same machine slot. A **new** `apiKey` replaces the old one.
- Open machine and CSP activity sessions of the old install are closed.
- Desktop: nothing new. Write a fresh `MachineConfig` as for any activation (section C).

**Same code on different hardware** (new fingerprint): 400 `Activation has already been used on another machine. Ask the owner to revoke it first.` Show the message.

**Revoke (mobile app / admin console, not the desktop).** The CSP (or BC, for BC codes) **requests** a revoke in the mobile app; the activation keeps working until the **super admin approves** it (a rejected request changes nothing). The super admin can also revoke directly. Once revoked:
- the PC holding it stops working at once (its next call gets 400 `Machine has no active activation.` → re-activation required, section H);
- the code goes back to unused and unassigned with the **same expiry** (no credit for days already used);
- the owner assigns it again, which gives a new password; it can then be activated on any PC.

## 16. Receipt counts: passbook, social security, per-agent ids, per-receipt validation — READY

- New values: `receiptType = PASSBOOK`, `transactionCategory = PASSBOOK_PRINTING`. Switch passbook prints from `UNKNOWN` / `OTHER` to these (`Forms/csp/CSPManagerForm.PassbookPrinting.cs`, plus the allowed lists in `Forms/csp/ReceiptUploadService.cs`). Rows already uploaded as `UNKNOWN` / `OTHER` with `transactionType = "Passbook Printing"` were re-categorised on the server.
- `PMJJBY`, `PMSBY`, `APY`, `UNKNOWN` with `SOCIAL_SECURITY` are accepted and counted; no `amount` needed. Passbook and social security never touch the float ledger.
- `receiptId` is now unique **per agent**, not across all machines. Length isn't limited.
- **Per-receipt validation:** one invalid receipt no longer fails the batch. It comes back in `skippedReceipts` with a reason starting `Invalid receipt`, e.g. `Invalid receipt (amount): Amount is required for cash and transfer transactions.` A receipt with no usable `receiptId` comes back with `"receiptId": null`.
- Desktop: a skipped receipt whose reason starts with `Invalid receipt` → `Failed` (keep the reason, don't retry). Other skipped reasons (`Receipt already exists.`, `Duplicate receipt in request.`) → `Uploaded`, as before. A whole-batch 400 now only happens for request-level problems (credentials missing, more than 20 receipts).
- Reports show Passbook Print and Social Security (PMJJBY, PMSBY, APY, Other) as their own columns.

## 17. `desktopControls`: admin switches — READY

Heartbeat **and** entitlements `data` now carry, for this machine:

```json
"desktopControls": {
  "services": {
    "BALANCE_ENQUIRY": true, "MINI_STATEMENT": true, "CASH_WITHDRAWAL": false,
    "CASH_DEPOSIT": true, "MONEY_TRANSFER": true, "PASSBOOK_PRINTING": true,
    "FUND_TRANSFER": true, "TRANSACTION_HISTORY": true, "KYC_UPDATION": true,
    "ACCOUNT_OPENING": true, "AADHAAR_SEEDING": true, "AEPS_REGISTRATION": true
  },
  "receiptCashDenominationConfirm": true
}
```

- The server always sends **all 12 codes**. A code the desktop doesn't know yet: treat as on.
- Set by the super admin only: a global switch (maintenance, applies to every machine) plus an optional per-machine override. A service is off when either turns it off.
- Desktop behaviour is as already built (start blocked with the admin message; `PASSBOOK_PRINTING` off also skips the "print the passbook?" question; `receiptCashDenominationConfirm = false` skips the popup). Cache in `MachineConfig` (`ServiceSwitches`, `ReceiptCashDenominationConfirm`). Missing object (older server): everything on.

## 18. Versions, portal URL, removed endpoints, rate limits — READY

- Heartbeat and entitlements `data`: `latestWatcherVersion`, `minimumVersion` (string or `null`) and `downloadUrl` (string or `null`), set by the super admin. Below `minimumVersion`: block automation and offer `downloadUrl`. Newer `latestWatcherVersion`: non-blocking "update available". `null` = no minimum / no download link yet.
- Entitlements `data.portalUrl`: the subscription page. It is `null` for now (the web portal doesn't exist yet). While it's `null`, hide or disable "Renew / subscribe".
- **Removed:** `POST /events`, `POST /api/events`, `POST /api/auth/activate`, `GET /api/config/sync`, `POST /receipt`. They now return 404. Remove the watcher's event queue and `/config/sync` code; don't send receipt contents anywhere except `/receipts/upload` / `/receipts/upload-counts`.
- **Rate limits** (429, body `{ "success": false, "message": "Too many requests. Please try again later." }`, `RateLimit-*` headers):
  - runtime calls and receipt uploads: 120 per minute **per machine** (combined);
  - `POST /machines/activate`: 20 per 15 minutes per IP;
  - every API request: 600 per minute per IP.
  
  On 429: keep everything queued and retry with the normal backoff; don't change state.

## 19. Machine credential security: device key + signed requests — READY

**Why:** the `apiKey` in the body is today the only real secret (machine code and fingerprint aren't), it never expires, and anyone who captures one request or copies `MachineConfig.json` can act as the PC. With a device key the PC proves itself with a private key that never leaves it, so nothing secret travels on the network, a copied config is useless on another PC, and a captured request can't be replayed.

The backend supports all of this now and stays **backward compatible**: a PC without a device key keeps using its `apiKey` exactly as today. Before production the server will be switched to require signatures (`MACHINE_SIGNATURE_REQUIRED=true`), so this item must ship in the first production desktop release.

### 19.1 HTTPS and key storage (do now)

- Production builds refuse `http://` base URLs (remove the test-server override, desktop `preproductioncheck` item 5).
- Until the device key ships, store `ApiKey` with **DPAPI** (`ProtectedData.Protect`, `DataProtectionScope.LocalMachine`, so both the UI and the service can read it) and restrict `MachineConfig.json` to SYSTEM + Administrators.

### 19.2 Create the device key at activation

1. Before calling `POST /machines/activate`, create an **ECDSA P-256** key that can't be exported:
   - preferred: CNG key in the **Microsoft Platform Crypto Provider** (TPM), e.g. `CngKey.Create(CngAlgorithm.ECDsaP256, "CSPManager-<machineCode or GUID>", new CngKeyCreationParameters { Provider = new CngProvider("Microsoft Platform Crypto Provider"), KeyCreationOptions = CngKeyCreationOptions.MachineKey, ExportPolicy = CngExportPolicies.None })`;
   - no TPM: same with `CngProvider.MicrosoftSoftwareKeyStorageProvider` (still machine-scoped and non-exportable).
   - `MachineKey` so the Windows service (SYSTEM) can use it. If CSP Manager runs as a normal user, grant that user access to the key at install time (the key's security descriptor), or route the UI's calls through the service. Store only the key **name** in `MachineConfig`.
2. Export the public key: `new ECDsaCng(key).ExportSubjectPublicKeyInfo()` → base64 → send it as `machine.devicePublicKey` in the activate body (PEM is accepted too).
3. On 201 the server has stored it. From now on **every** runtime and upload call for this PC must be signed (19.3); the `apiKey` alone is refused with 400 `Signed request required for this machine.` Keep the returned `apiKey` only as a fallback for older code paths; don't send it on signed calls.
4. Every re-activation (format, new agent) creates a **new** key and sends it; the server replaces the old one. A re-activation **without** `devicePublicKey` clears the key on the server and the PC is back on `apiKey` auth (older desktop builds keep working).
5. Server errors at activation: 400 `Device public key is not a valid public key.` / `Device public key must be an ECDSA P-256 key.`

### 19.3 Sign every request

Send these headers on Q2–Q8 (machine credentials move to headers; the body keeps only the endpoint's own fields):

| Header | Value |
|---|---|
| `X-Machine-Code` | `MachineConfig.MachineCode` |
| `X-Machine-Fingerprint` | `MachineConfig.Fingerprint` |
| `X-Timestamp` | Unix time in **seconds**, UTC (`DateTimeOffset.UtcNow.ToUnixTimeSeconds()`) |
| `X-Nonce` | new random value per request: 16–64 of `A–Z a–z 0–9 - _` (e.g. `Guid.NewGuid().ToString("N")`) |
| `X-Signature` | base64 of the signature below |

String to sign (UTF-8, `\n` = LF, no trailing newline):

```
POST
/api/v1/machines/runtime/heartbeat
1761800000
3f2a9c0e8b7d4e1fa0c2b5d6e7f80912
<lowercase hex SHA-256 of the exact body bytes you send>
```

- Line 2 is the path **as sent**, starting with `/api/v1`, including any query string.
- Hash the **exact bytes** you put on the wire: serialize the body once, hash those bytes, send those bytes (don't re-serialize after signing). Empty body → hash of zero bytes.
- Sign with `ECDsa.SignData(bytes, HashAlgorithmName.SHA256)`: .NET returns the 64-byte IEEE P1363 (r‖s) form, which the server expects. DER signatures are accepted too.

```csharp
string Sign(ECDsa key, string method, string path, byte[] body, out string ts, out string nonce)
{
    ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
    nonce = Guid.NewGuid().ToString("N");
    var hash = Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant();
    var data = Encoding.UTF8.GetBytes($"{method}\n{path}\n{ts}\n{nonce}\n{hash}");
    return Convert.ToBase64String(key.SignData(data, HashAlgorithmName.SHA256));
}
```

Server checks and errors (all **400**; add them to section H):

| Message | Desktop action |
|---|---|
| `X-Timestamp must be Unix time in seconds.` / `X-Nonce must be 16-64 letters, digits, '-' or '_'.` | bug: fix the client; don't retry the same request |
| `Request timestamp is too old or in the future. Check the PC clock.` | the PC clock is off by more than 5 min: show a clock warning (compare with heartbeat `serverTime`); retry after it's fixed |
| `Invalid request signature.` | body/path changed after signing, or wrong key. Retry once with a fresh signature; if it fails again → **re-activation required** (the key was lost or replaced) |
| `Request has already been used (replayed nonce).` | you reused a nonce: generate a new one per attempt, including retries |
| `This machine has no device key. Re-activate it to register one.` | the server has no key for this PC (e.g. re-activated by an older build): re-activate |
| `Signed request required for this machine.` | a call went out unsigned: sign it |
| `Signed requests are required. Re-activate this PC to register a device key.` | production server and this PC has no key: re-activate (19.2) |

Retries must be **re-signed** (new timestamp and nonce). Every call, signed or failed, counts toward the 120/min per machine.

### 19.4 Header credentials without signing (optional step)

If the device key can't ship at once, credentials can move to headers first: `X-Machine-Code`, `X-Machine-Fingerprint`, `Authorization: Machine <apiKey>`. The body then doesn't need them. If a value is in both the header and the body, they must match (400 `Machine credentials in the headers and the body don't match.`). This keeps the key out of body logs but is **not** enough for production; 19.2–19.3 are.

## 20. Receipt retention: old receipts refused, `totalCount` for 12 months — READY

The server keeps receipts for a retention period, by `transactionAt`: **60 days by default**, which the super admin can set anywhere from **15 to 365 days**. Per-day counts are kept for **1 year**. A daily job deletes older receipts. Raising the period never re-opens days that were already deleted.

- Both upload endpoints skip a receipt whose `transactionAt` is before that window: `skippedReceipts: [{ receiptId, reason: "Receipt is older than the receipt retention period." }]`. The rest of the batch is saved. A missing `transactionAt` on `upload-counts` means "now", so it is never refused.
- Queue action: **`Failed` ("too old"), no retry.** Retrying can't succeed, and it can't be counted: an accepted old receipt could already have been deleted and would be counted twice. With the 60-day default, the desktop's own 30-day queue limit (section G) makes this rare. If the period is set below 30 days, queued receipts older than it are refused this way. Treat that as the same "too old" case.
- `totalCount` in the `upload-counts` response now comes from the daily counts. It is the agent's total for the **last 12 months**, not all time. Keep using it for the on-screen counters.
- Nothing else changes: the same request and response shapes, ids, and duplicate handling.

---

## 21. Cash management on the desktop — READY

A CSP and its KOs share **one cash limit** and **one cash in account**; each agent (the CSP or a KO) has its **own cash in hand** and **drawer** (note/coin counts). On the desktop the balances are **read-only**: the KO can't set them. What the KO does on the desktop moves them through the server: receipts (21.3), settlements it approves itself (21.7), and the cash extras of item 22 (custom transactions, balance due, cash exchange). A correction of cash in hand is a request the CSP approves (21.4). Every change is in the CSP's cash ledger.

### 21.1 Read the cash from the heartbeat (no extra call per transaction)

`POST /machines/runtime/heartbeat` now returns `data.cash` for the machine's assigned agent:

```json
"cash": {
  "setUp": true,
  "cspAgentId": "CSP-001", "agentId": "KO-001",
  "cashLimit": 100000, "cashInAccount": 45000, "cashInTransit": 0, "cashLeftInBank": 0, "cashOther": 0, "cashInHand": 55000,
  "drawer": { "notes500": 90, "notes200": 0, "notes100": 50, "notes50": 0, "notes20": 0, "notes10": 0, "notes5": 0, "coins20": 0, "coins10": 0, "coins5": 0, "coins2": 0, "coins1": 0 },
  "drawerTotal": 50000,
  "lastRequest": { "id": "…", "status": "PENDING", "requestedCashInHand": 54000, "reason": "…", "reviewRemarks": null, "createdAt": "…" },
  "cashDueExtra": 0,
  "dues": { "toCollect": 0, "toGive": 0, "openCount": 0, "bySide": { "CASH_IN_HAND": { "toCollect": 0, "toGive": 0 }, "CASH_IN_ACCOUNT": { "toCollect": 0, "toGive": 0 }, "OTHER_CASH": { "toCollect": 0, "toGive": 0 } } },
  "openSettlement": { "id": "…", "requestId": "…", "direction": "ACCOUNT_TO_HAND", "step": "FROM_BANK", "stepNumber": 2, "stepCount": 2, "amount": 50000, "label": "Bank → cash in hand", "needsDenomination": true },
  "tasks": { "openCount": 2, "overdueCount": 0, "newFromCspCount": 1 },
  "updatedAt": "…"
}
```

- Save it to `machineConfig.json` on every heartbeat (60 s), and show it read-only on the cash screen: total cash limit, cash in account, cash in hand, drawer. `cash` is `null` when the agent isn't part of a CSP.
- `setUp: false` (`cashLimit` / `cashInAccount` null): the CSP hasn't set up cash management yet. Don't block transactions; show "Cash management not set up by the CSP".

### 21.2 Check before every cash transaction (from the saved config)

| Transaction | Allowed when (from `machineConfig.json`) |
|---|---|
| Cash withdrawal | `amount` ≤ `cashInHand` |
| Cash deposit, money transfer | `amount` ≤ `cashInAccount` |

When it isn't allowed, stop before the SBI workflow: "Not enough cash in hand (₹55,000). Ask the CSP to settle cash." After a successful transaction, update the saved values locally until the next heartbeat (withdrawal: hand −, account +; deposit / money transfer: hand +, account −), so back-to-back transactions are checked correctly. The heartbeat is always the truth: overwrite the local values with it.

### 21.3 Upload result per receipt

`upload-counts` `acceptedReceipts[]` items for cash categories now carry `cash`:

```json
{ "receiptId": "R-1", "count": 1, "cash": { "status": "APPLIED" } }
{ "receiptId": "R-2", "count": 1, "cash": { "status": "NOT_APPLIED", "reason": "INSUFFICIENT_CASH_IN_HAND" } }
```

`reason`: `INSUFFICIENT_CASH_IN_HAND`, `INSUFFICIENT_CASH_IN_ACCOUNT`, or `NOT_SET_UP`. Either way the receipt **is saved and counted**: mark it `Uploaded` in the queue as usual. `NOT_APPLIED` means the balances didn't change (they would have gone negative); the CSP sees it in the ledger and fixes it with a settlement or adjustment. Show a notice, but don't retry. Non-cash receipts have no `cash` field. The legacy `/receipts/upload` returns the same `cash` object on each `uploadedReceipts` item (`ledgerCreated` = `cash.status === "APPLIED"`).

The `cashDenomination` you already send updates the agent's drawer: deposit and money transfer add notes, withdrawal takes them away (a count never goes below 0).

### 21.5 Count the cash when activating the PC

On the activation screen, ask the operator for the **cash in hand** and the **drawer** (note/coin counts), and send them with `POST /machines/activate` (Q1):

| Field | Rule |
|---|---|
| `cashInHand` | **required for a KO** (`Cash in hand is required.`); ₹ ≥ 0, 2 decimals |
| `cashDenomination` | **required with it** (`Cash denomination is required.`): the 12 keys of item #2, integers 0–100,000; the full drawer (keys left out = 0). Total must equal `cashInHand` (`Cash denomination total (₹…) must equal cash in hand (₹…).`) |

For a CSP's own PC both are optional; send them together to set the CSP's cash in hand too. Ask for them on **every** activation, whatever the plan: the server keeps them.

What the server does, in the same transaction as the activation:
- Sets that agent's cash in hand and drawer to these values.
- Changes the shared cash in account by the difference, so cash in account + all cash in hand still equals the cash limit. Example: KO had ₹5,000 and counts ₹6,000, so cash in account goes from ₹90,000 to ₹89,000.
- Audits it as `ACTIVATION` in the CSP's cash ledger.

If cash in account can't cover the increase, the activation is refused with 400 `Not enough cash in account for this cash in hand: …`, and nothing is activated. Show the message: the CSP must settle cash or raise the limit first. When the CSP hasn't set up cash management, the activation still succeeds and the count is **saved**: `data.cash` is `{ "status": "SAVED", "cashInHand": 3000 }`; it applies when the CSP sets up (taken from cash in account). `{ "status": "NOT_SET_UP" }` now only means the agent isn't part of a CSP (nothing kept).

Re-activating the same PC (after a format) asks for the count again; it replaces the stored values the same way. Then write `data.cash` to `machineConfig.json` straight away; the next heartbeat brings the full `cash` block (21.1).

### 21.6 Today's cash screen: `GET /machines/runtime/cash`

For the cash management screen of **this PC's agent only**. Send the machine credentials as headers (`X-Machine-Code`, `X-Machine-Fingerprint`, `Authorization: Machine <apiKey>`; signed requests as usual); `POST /machines/runtime/cash` with the credentials in the body returns the same thing. "Today" is the IST day.

```json
"data": {
  "setUp": true,
  "date": "2026-11-02T09:30:00.000Z",
  "agent": { "agentId": "KO-001", "name": "…", "cspAgentId": "CSP-001" },
  "cashLimit": 100000, "cashInAccount": 40000, "cashInTransit": 0, "cashLeftInBank": 2000, "cashInHand": 53000,
  "drawer": { "notes500": 106, "notes200": 0, "notes100": 0, "…": 0 }, "drawerTotal": 53000, "drawerMatchesCashInHand": true,
  "today": {
    "totals": { "deposits": 0, "withdrawals": 0, "moneyTransfers": 0, "settlementsIn": 48000, "settlementsOut": 0 },
    "transactions": [
      { "id": "…", "type": "SETTLEMENT_FROM_BANK", "reason": null, "transactionCategory": null, "amount": 50000,
        "cashInHandChange": 48000, "cashInAccountChange": 0, "balanceCashInHand": 53000, "balanceCashInAccount": 40000,
        "drawerChange": { "notes500": 96 }, "receiptId": null, "settlementId": "…", "remarks": "Bank → cash in hand", "createdAt": "…" }
    ],
    "settlements": [ <today's finished settlement steps> ]
  },
  "openSettlements": [ <this agent's open steps, oldest first> ],
  "lastRequest": { "id": "…", "status": "PENDING", "requestedCashInHand": 52500, "reviewRemarks": null, "createdAt": "…" } | null
}
```

- Show all of it read-only: total cash limit, cash in account (holding, shared), in bank (open settlements), **left in bank** (`cashLeftInBank`, shown separately: what partly delivered settlements left at the bank), its own cash in hand and drawer, today's history (receipts, settlements, activation count, approved corrections; newest first, max 500), and the open settlements with their action buttons (21.7).
- `transactions[].type`: `RECEIPT`, `RECEIPT_NOT_APPLIED` (+ `reason`), `ACTIVATION`, `SETTLEMENT_TO_BANK`, `SETTLEMENT_FROM_BANK`, `SETTLEMENT_HELD`, `SETTLEMENT_CANCELLED`, `REQUEST_APPROVED`, `ADJUSTMENT` (by the CSP), `AGENT_ADDED`, `OPENING`.
- Refresh it when the screen opens and after every settlement action; the heartbeat `cash` (21.1) stays the source for the pre-check.
- Errors: 400 `This agent isn't part of a CSP.`, 403 `No agent is currently assigned to this machine.`, machine-auth errors (section H).

### 21.7 Settlement: the KO's own two steps (no CSP approval)

The "Settlement" button. Two directions, each in two steps that **the KO approves itself**; the CSP only sees them in the app.

| Direction | Step 1 — `TO_BANK` (create) | Step 2 — `FROM_BANK` (opens when step 1 is approved) |
|---|---|---|
| `ACCOUNT_TO_HAND` (KO needs cash) | "Cash in account → bank": `amount`. Taken out of the shared cash in account at once and held in bank (`cashInTransit`), so the other KOs already see the lower cash in account | "Bank → cash in hand": approve with `cashDenomination`, the notes received; total > 0 and ≤ amount. Added to this KO's drawer and cash in hand; any difference stays **left in bank** |
| `HAND_TO_ACCOUNT` | "Cash in hand → bank": `amount` + `cashDenomination` (the notes taken out; total = amount). Taken out of cash in hand and the drawer, held in bank | "Bank → cash in account": approve with `amount`, what was credited (> 0 and ≤ amount; leave it out for the full amount); any difference stays **left in bank** |
| `BANK_TO_HAND` (bring back what's left in bank) | — (no step 1) | "Left in bank → cash in hand": create with `amount` (≤ `cashLeftInBank`); it's taken out of left in bank at once and held (`cashInTransit`), so other KOs can't take it too. Approve with `cashDenomination`, the notes received (total > 0 and ≤ amount); added to this KO's drawer and cash in hand, any difference goes back to left in bank. Cancel puts it back in left in bank |

Nothing goes beyond the limit: cash in account + all cash in hand + in bank + left in bank = cash limit at all times. **One open settlement per KO at a time**: while step 1 or step 2 is open, a new one gets 409 `This agent already has an open settlement. Approve or cancel it first.` Disable the Settlement button while `openSettlements` isn't empty.

**Create step 1:** `POST /machines/runtime/cash/settlements`

```json
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…",
  "direction": "ACCOUNT_TO_HAND", "amount": 50000, "remarks": "Need cash for withdrawals" }
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…",
  "direction": "HAND_TO_ACCOUNT", "amount": 3000, "cashDenomination": { "notes500": 6 } }
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…",
  "direction": "BANK_TO_HAND", "amount": 2000 }
```

`BANK_TO_HAND` returns the step as `step: "FROM_BANK"`, `needsDenomination: true`, label `Left in bank → cash in hand`; approve it directly (no step 1). Show the button only when `cashLeftInBank` > 0.

→ 201 `Settlement started. Approve it when the bank step is done.` `data: { id, direction, step: "TO_BANK" (FROM_BANK for BANK_TO_HAND), label, status: "PENDING", amount, … }`. Errors (400): `Not enough cash in account: ₹… available, ₹… requested.`, `Not enough cash left in bank: ₹… available, ₹… requested.`, `Not enough cash in hand: …`, `Cash denomination is required: the notes taken out of the drawer.`, `Cash denomination total (₹…) must equal the amount (₹…).`, `Amount must be more than 0.`, `Cash management isn't set up for this CSP yet. …`.

**Approve or cancel an open step:** `POST /machines/runtime/cash/settlements/:settlementId`

```json
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…", "action": "APPROVE" }
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…", "action": "APPROVE", "cashDenomination": { "notes500": 96 } }
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…", "action": "APPROVE", "amount": 2000 }
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…", "action": "CANCEL", "remarks": "Bank closed" }
```

| Call | Result |
|---|---|
| APPROVE step 1 | 200 `Step approved. The next step is open.` `data: { approved, next }`: `next` is step 2 (`FROM_BANK`, `needsDenomination` true for ACCOUNT_TO_HAND) |
| APPROVE step 2 | 200 `Settlement completed.` `data: { approved, next: null }`; `approved.settledAmount` = what reached the destination, `approved.leftInBank` = the rest |
| CANCEL (step 1 or 2) | 200 `Settlement cancelled; the amount went back.` `data: { cancelled, next: null }`: money (and, for HAND_TO_ACCOUNT, the notes) back where they came from |

Errors: 404 `Settlement not found.` (not this agent's), 409 `This settlement step is already approved.` / `… cancelled.`, 400 `Cash denomination is required: the notes received from the bank.`, `Cash denomination total (₹…) must be more than ₹0 and at most the amount in bank (₹…).`, `Amount credited (₹…) must be more than ₹0 and at most the amount in bank (₹…).`; on create also 409 `This agent already has an open settlement. Approve or cancel it first.`

**Screen flow (cash screen, from §21.6 data):**

1. **Open the cash screen** → call `GET /machines/runtime/cash`. Show limit, cash in account, in bank (`cashInTransit`), left in bank (`cashLeftInBank`), own cash in hand + drawer, today's totals and history.
2. **Open settlement?** If `openSettlements` is not empty, show it as a card with **Approve** / **Cancel** and **disable the Settlement button** (one at a time; the server answers 409 otherwise).
3. **Settlement button** → popup "What do you want to do?":
   - **Get cash from account** (`ACCOUNT_TO_HAND`) → amount (≤ `cashInAccount`).
   - **Deposit cash to account** (`HAND_TO_ACCOUNT`) → amount + notes taken out of the drawer (total = amount, each count ≤ the drawer).
   - **Get cash left in bank** (`BANK_TO_HAND`) → amount (≤ `cashLeftInBank`). Show this option only when `cashLeftInBank` > 0.
   → `POST /machines/runtime/cash/settlements` → refresh the screen.
4. **Approve** on the open card, by its `step` and `needsDenomination`:
   - `TO_BANK` (step 1, the money reached the bank) → confirm → `{ action: "APPROVE" }`. The response's `next` is step 2: show it as the new open card.
   - `FROM_BANK` with `needsDenomination: true` (bank → cash in hand, also `BANK_TO_HAND`) → **denomination popup** for the notes received; show the running total and "at most ₹`amount`" → `{ action: "APPROVE", cashDenomination }`. If the total is less, say "₹… stays left in bank".
   - `FROM_BANK` with `needsDenomination: false` (bank → cash in account) → amount field prefilled with `amount` → `{ action: "APPROVE", amount }`. If it's less, say "₹… stays left in bank".
5. **Cancel** on the open card → confirm (optional remarks) → `{ action: "CANCEL" }`. The money (and notes) go back where they came from: cash in account, cash in hand + drawer, or left in bank.
6. After every action: refresh the cash screen (`GET /machines/runtime/cash`) and save the returned balances over the heartbeat `cash` in `machineConfig.json`, so the pre-check (§21.2) uses the new values right away.

| Direction | Cards the KO sees | Approve needs |
|---|---|---|
| `ACCOUNT_TO_HAND` | 1 "Cash in account → bank" → 2 "Bank → cash in hand" | 1: nothing · 2: notes received (≤ amount) |
| `HAND_TO_ACCOUNT` | 1 "Cash in hand → bank" → 2 "Bank → cash in account" | 1: nothing · 2: amount credited (≤ amount; default all) |
| `BANK_TO_HAND` | only "Left in bank → cash in hand" | notes received (≤ amount) |

Show `label` from the response as the card title. Every step is in the CSP's ledger (`SETTLEMENT_TO_BANK`, `SETTLEMENT_FROM_BANK`, `SETTLEMENT_HELD`, `SETTLEMENT_CANCELLED`) and in its settlements feed; the CSP doesn't approve anything.

**One request, two steps (rev 21):** every step object has `requestId` (step 1's id; the same on both steps), `requestStartedAt`, `stepNumber` (1 / 2), `stepCount` (2; 1 for `BANK_TO_HAND`) and, on step 2, `previousStep: { id, approvedAt, amount }`. The heartbeat `cash.openSettlement` is the step waiting for the KO.

### 21.4 Ask the CSP to change cash in hand / drawer

`POST /machines/runtime/cash/requests` (machine auth, like the other runtime calls)

```json
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…",
  "cashInHand": 54000,
  "drawer": { "notes500": 98, "notes100": 50 },
  "reason": "Counted ₹1,000 less than the system" }
```

| Field | Rule |
|---|---|
| `cashInHand` | required, ₹ ≥ 0, 2 decimals (`Cash in hand is required.`) |
| `drawer` | optional; the note/coin keys above, integers 0–100,000; keys left out keep their count |
| `reason` | required, 1–500 chars (`Reason is required.`) |

→ 201 `Cash change request sent to the CSP for approval.` `data: { id, status: "PENDING", requestedCashInHand, systemCashInHand, requestedDrawer, reason, … }`. Errors: 409 `A cash change request is already pending for this agent. …` (one at a time), 400 `Cash management isn't set up for this CSP yet. …`, 403 `No agent is currently assigned to this machine.`, plus the usual machine-auth errors (section H).

Nothing changes until the CSP approves. The result shows in the next heartbeats as `cash.lastRequest.status` (`APPROVED` / `REJECTED`, with `reviewRemarks`), and on approval `cashInHand` / `drawer` show the new values.

## 22. Cash management extras (desktop requirements doc, item 6) — READY

The backend answer to the desktop's "Backend requirements" doc, **item 6** (custom transactions, balance due, close the day, history, cash exchange, tasks). Everything you asked for is built with your paths, bodies and error messages, **except the points marked ⚠ below**, which differ from your ask. Read those first.

### 22.0 Coverage of your requirements doc, item 6

| Your item | What you asked | Backend | Where |
|---|---|---|---|
| Plan check | show nothing without `CASH_MANAGEMENT` | Desktop-only as you planned (heartbeat `features`), **and** the server now refuses desktop cash calls (⚠ 1) | 22.0 |
| "Not set up" state | `cash.setUp = false` | Unchanged | 21.1 |
| Controller cash strip | heartbeat `cash` | Unchanged, plus `cashOther` and `dues` | 21.1 |
| Activation count | any agent, stored before setup | Done (⚠ 4) | 21.5 |
| 6.1 Labels + custom transactions | `GET /cash/labels`, `POST /cash/custom-transactions`, CSP manages labels | Done, your bodies and messages (cash in account unchanged; ⚠ 2 other cash) | 22.1 |
| 6.2 Balance due | list / add / settle / cancel; CSP sees dues; confirm "float with dues" | Done (⚠ 3 for receipt dues); dues don't change the cash limit picture until settled, as you said | 22.2 |
| 6.3 Close the day | close + read; CSP sees it; open questions | Done; transactions aren't blocked after the close; `NOT_CLOSED` computed | 22.4 |
| 6.4 History | `GET /cash/days` (or POST), `GET /cash?date=` with `dayClose` | Done (≤ 92 days per call) | 22.5 |
| 6.5 Cash exchange | create + list | Done | 22.3 |
| 6.6 Tasks | list / add / change / delete; CSP gives tasks | Done; push when the CSP adds one is later (pre-production checklist 2.16) | 22.6 |
| 6.7 Existing answers | new types in `today.transactions` and the CSP ledger; heartbeat `cash.dues` | Done | 22.5, 21.1 |

### 22.0a What's different from your ask (⚠) and what's new

| # | Point | What the backend does |
|---|---|---|
| ⚠ 1 | **Plan check on the server** | Every desktop cash call (§21.6–21.7, 21.4, and all of item 22) now answers **403 `This plan doesn't include cash management.`** when the PC's plan (CSP plans) has no `CASH_MANAGEMENT`. Keep your own check from the heartbeat `features`; treat this 403 as "hide cash management", not as a lock. |
| ⚠ 2 | **Other cash** (new balance) | Custom transactions and settled dues bring cash in from outside SBI (or send it out). They change cash in hand and the drawer; **cash in account doesn't change**, as you asked. To keep the books balanced, the pool has a new **`cashOther`** (+ = came in, − = went out): cash in account + all cash in hand + in bank + left in bank (+ extra cash held by dues, rev 21) = cash limit + other cash. It's in the heartbeat `cash`, today's screen and the CSP's pool view. Show it read-only as "Other cash (custom transactions & dues)"; the CSP clears it in the app. |
| ⚠ 3 | **Due for a receipt moves cash** | Your doc says adding a due moves no cash. That stays true for `MANUAL` dues and dues made by a custom transaction. **But a due with `receiptId`** for a cash receipt the server already applied (e.g. a ₹2,000 deposit the customer pays tomorrow) takes the unpaid amount **out of** cash in hand (`TO_COLLECT`) or puts it **back** (`TO_GIVE`), because the upload already counted the full amount. Settling puts it back. Without this the cash would be counted twice. Optional `cashDenomination` (total = amount) moves the notes too. |
| ⚠ 4 | **Activation count before setup** | You asked to accept the count for any agent and keep it when cash management isn't set up. Done: the count is accepted for any agent of a CSP (still **required for a KO**), and when the CSP hasn't set up cash management it's **saved** (`data.cash = { "status": "SAVED", "cashInHand": 3000 }`, no longer `NOT_SET_UP`). When the CSP sets up, the saved counts are taken from cash in account. `NOT_SET_UP` now only means "this agent isn't part of a CSP" (nothing kept). |
| 5 | Day close doesn't block | Your open question: transactions after the close are **not blocked**; they just come after the close time on the same IST day. |
| 6 | `NOT_CLOSED` | Worked out when you read the days (no midnight job). Days before the agent was created aren't listed. |
| 7 | Range limit | `/cash/days`: at most **92 days per call** (default the last 14). The ledger isn't deleted by receipt retention, so older days stay available. |
| 8 | Denomination objects | Every `cashDenomination`, `taken`, `given`, `drawer` in answers has **all 12 keys** (zeros included). |
| 9 | Reads with body credentials | `/cash/labels` and `/cash/days` also take `POST` with the credentials (and `from` / `to`) in the body, as you asked for the day list. The other reads (`/cash/dues`, `/cash/exchanges`, `/cash/day-close`, `/cash/tasks`) are `GET` only, because `POST` on those paths creates: send the credentials in **headers** (`X-Machine-Code`, `X-Machine-Fingerprint`, `Authorization: Machine <apiKey>`, or signed). |
| 10 | Amounts in messages | Messages show whole rupees without decimals where you wrote them so (`Day closed. You're ₹500 short.`, `Saved. ₹500 added to …`); validation messages use 2 decimals (`… (₹500.00) must equal …`). Show `message` as it comes. |
| 11 | Keep the saved cash current | After every call that answers with `cash` (custom transaction, due settle) or changes balances (exchange, due add/cancel, day close), overwrite `cashInHand` / `drawer` in `machineConfig.json` from the answer or re-read `GET /machines/runtime/cash`, so the pre-check of §21.2 uses the new values before the next heartbeat. |

### 22.1 Labels and custom transactions (your 6.1)

**`GET /machines/runtime/cash/labels`** (credentials in headers; or `POST` with them in the body) → `data: [ { id, name, direction: "IN"|"OUT"|"BOTH", active, createdAt, updatedAt } ]`, active first. List only `active` ones. The CSP creates, renames and deactivates them in the app. A new pool starts with **Other** (`BOTH`), **Shop expense** (`OUT`), **Bill collection** (`IN`) and **Recharge** (`IN`) (rev 21).

**`POST /machines/runtime/cash/custom-transactions`**

```json
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…",
  "labelId": "…", "direction": "IN", "amount": 1500, "paidNow": 1000,
  "cashDenomination": { "notes500": 2 }, "note": "optional, ≤ 200" }
```

| Rule | Error (400) |
|---|---|
| label is the CSP's and active | `That label isn't available any more. Ask your CSP.` |
| direction allowed by the label | `That label can't be used for cash in.` / `… cash out.` |
| `amount` > 0 | `Enter an amount more than ₹0.` |
| 0 ≤ `paidNow` ≤ `amount` | `Paid now must be between ₹0 and the amount.` |
| notes total = `paidNow` (send `{}` or nothing when 0) | `The notes' total (₹….00) must equal paid now (₹….00).` |
| OUT: `paidNow` ≤ cash in hand; each count ≤ the drawer | `That's more than your cash in hand (₹…).` / `Not enough ₹100 notes in the drawer.` (coins: `₹2 coins`) |
| pool set up | `Cash management isn't set up for this CSP yet. …` |

Effect: IN → cash in hand, drawer and other cash **+ paidNow**; OUT → **−**. Cash in account unchanged. `paidNow < amount` → a due for the rest (`source: "CUSTOM"`; IN → `TO_COLLECT`, OUT → `TO_GIVE`). Ledger `CUSTOM` (`amount` = full amount, `cashInHandChange` = ±paidNow, `remarks` = label · note), plus `DUE_CREATED` when a due was made.

→ **201** `Saved.` or `Saved. ₹500 added to Balance due (to collect).`, `data: { transaction: { id, labelId, label, direction, amount, paidNow, cashDenomination | null, note, createdAt }, due: <due> | null, cash: { cashInHand, drawer, drawerTotal } }`. Update the strip from `cash`.

### 22.2 Balance due (your 6.2, and 6.8 points 1, 2, 8)

The due object: `{ id, agentId, kind: "TO_COLLECT"|"TO_GIVE", amount (still due; 0 once settled), originalAmount (always there), source: "RECEIPT"|"CUSTOM"|"MANUAL", receiptId, customTransactionId, label, note, status: "OPEN"|"SETTLED"|"CANCELLED", cashSide: "CASH_IN_HAND"|"CASH_IN_ACCOUNT"|"OTHER_CASH"|null, createdAt, settledAt }` (list items also have `agentName`).

**`GET /machines/runtime/cash/dues?status=OPEN|CLOSED`** → `data: { dues: [ … ], totals: { toCollect, collectCount, toGive, giveCount } }`. OPEN oldest first; CLOSED = settled or cancelled in the last 14 days, newest first. `totals` are always the open dues.

#### Add a due: `POST /machines/runtime/cash/dues`

```json
{ …credentials, "kind": "TO_COLLECT", "amount": 1000, "note": "Pays tomorrow", "cashSide": "CASH_IN_HAND" }
{ …credentials, "kind": "TO_COLLECT", "amount": 2000, "note": "Deposit, pays tomorrow", "receiptId": "R-1", "cashDenomination": { "notes500": 4 } }
{ …credentials, "kind": "TO_GIVE", "amount": 100, "note": "Change owed" }
```

Three kinds of due:

| Due | What moves **now** | Settle | Cancel |
|---|---|---|---|
| **With `cashSide`** (no receipt; your point 8) | see the table below | moves the side back for the part paid, then the notes come in / go out (cash in hand, drawer, other cash) | moves the side back for what's still due |
| **With `receiptId`** of a cash receipt the server applied (⚠ 3, point 1) | the unpaid amount and its notes: `TO_COLLECT` out of cash in hand and the drawer, `TO_GIVE` back in (other cash moves with it). **`cashDenomination` is required** (total = amount) | the notes come in / go out; net effect: as if the customer had paid in full at the receipt | cash in hand back; the same notes back too while nothing was paid yet (after a part payment only cash in hand: fix the drawer with a correction request) |
| **Neither** (`MANUAL`, or a receipt whose cash wasn't applied) | nothing | the notes come in / go out (cash in hand, drawer, other cash) | nothing |

`cashSide` at creation (amount A). Everything but extra cash stays inside the cash limit, so cash in hand and cash in account move **against each other**:

| Due | `cashSide` | cash in hand | cash in account | other cash | extra cash held by dues |
|---|---|---|---|---|---|
| `TO_COLLECT` | `CASH_IN_HAND` | +A | −A | | |
| `TO_COLLECT` | `CASH_IN_ACCOUNT` | −A | +A | | |
| `TO_COLLECT` | `OTHER_CASH` | | | +A | +A |
| `TO_GIVE` | `CASH_IN_HAND` | −A | +A | | |
| `TO_GIVE` | `CASH_IN_ACCOUNT` | +A | −A | | |
| `TO_GIVE` | `OTHER_CASH` | | | −A | −A |

**Extra cash held by dues** (`cashDueExtra`, new pool balance; + to collect, − to give) is what open `OTHER_CASH` dues are worth. It's there so the books still balance when other cash moves alone: **cash in account + all cash in hand + in bank + left in bank + extra cash held by dues = cash limit + other cash.** It's in the heartbeat `cash`, the cash screen and every `cash` object below. For your limit bar: CSP and other KOs = limit + other cash − cash in account − my cash in hand − in bank − left in bank − extra cash held by dues.

No notes move with a `cashSide` due when it's added (the drawer changes when it's settled), so `drawerMatchesCashInHand` can be off by the open `CASH_IN_HAND` / `CASH_IN_ACCOUNT` dues until then. That's expected: show it as "held by dues" (`dues.bySide` below).

→ **201**, `message` says the move in words; show it as it comes:

| Due | `message` |
|---|---|
| to collect, cash in hand | `Balance due added. ₹1,000 added to cash in hand; cash in account −₹1,000.` |
| to collect, cash in account | `Balance due added. ₹1,000 added to cash in account; cash in hand −₹1,000.` |
| to collect, extra cash | `Balance due added. ₹1,000 added to extra cash.` |
| to give, cash in hand / account / extra cash | `Balance due added. ₹1,000 deducted from cash in hand; cash in account +₹1,000.` (and the same pattern) |
| receipt due | `Balance due added. ₹2,000 taken out of cash in hand.` / `… put back into cash in hand.` |
| no side, no receipt | `Balance due added.` |

`data` = the due (its fields at the top, as before) **plus `cash`**: `{ cashInHand, cashInAccount, cashOther, cashDueExtra, drawer, drawerTotal }`, the agent's balances after the move. The same `cash` object comes back from SETTLE and CANCEL (`data: { due, cash }`) and from a custom transaction.

| Rule | Error | `code` |
|---|---|---|
| `kind` | 400 `Pick to collect or to give.` | `VALIDATION_FAILED` |
| `amount` > 0 | 400 `Enter an amount more than ₹0.` | `VALIDATION_FAILED` |
| `note` 1–200 | 400 `Say what it's for.` | `VALIDATION_FAILED` |
| `cashSide` one of the three | 400 `Choose where to add / deduct the amount.` | `VALIDATION_FAILED` |
| no `cashSide` with `receiptId` | 400 `A due for a receipt has no cash side: leave cashSide out.` | `BAD_REQUEST` |
| `receiptId` is this agent's receipt | 404 `Receipt not found for this agent.` | `RECEIPT_NOT_FOUND` |
| due ≤ the receipt's amount | 400 `The due can't be more than the receipt amount (₹…).` | `BAD_REQUEST` |
| one open due per receipt | 409 `This receipt already has an open due.` | `RECEIPT_DUE_ALREADY_OPEN` |
| receipt due (applied): notes sent, total = amount, `TO_COLLECT` counts ≤ drawer | 400 `Cash denomination is required for a receipt due: …` / `The notes' total … must equal the amount …` / `Not enough ₹500 notes in the drawer.` | `DENOMINATION_REQUIRED` / `DENOMINATION_MISMATCH` / `DRAWER_TOO_FEW_NOTES` |
| the side that goes **down** has the amount | 400 `That's more than your cash in hand (₹…).` / `That's more than the cash in account (₹…).` (shared by the CSP and its KOs) | `INSUFFICIENT_CASH_IN_HAND` / `INSUFFICIENT_CASH_IN_ACCOUNT` |

**Which receipts** (your point 2): any receipt of this agent that's still stored (the retention period, default 60 days), any day, any category. Cash moves only when the receipt's cash was applied (a `RECEIPT` ledger entry); for a `RECEIPT_NOT_APPLIED` or non-cash receipt the due moves nothing (like a manual due) and needs no notes. Offering only today's applied cash receipts, as you do, is fine.

#### One due with its history: `GET /machines/runtime/cash/dues/:id`

(credentials in headers) → the due + `events` (oldest first): `[{ type: "CREATED" | "PART_SETTLED" | "SETTLED" | "CANCELLED", amount, stillDue, cashSide, cashInHandChange, cashInAccountChange, cashOtherChange, drawerChange, machineCode, remarks, createdAt }]`, for a "History" view. 404 `Due not found.` (not this agent's).

#### Settle or cancel: `POST /machines/runtime/cash/dues/:id`

`{ "action": "SETTLE", "amount": 500, "cashDenomination": { "notes500": 1 } }` or `{ "action": "CANCEL" }`.

| Rule | Error (400 unless noted) | `code` |
|---|---|---|
| the agent's due | 404 `Due not found.` | `DUE_NOT_FOUND` |
| `OPEN` | `This due is already settled or cancelled.` | `DUE_NOT_OPEN` |
| SETTLE: `amount` and `cashDenomination` sent | `Enter an amount more than ₹0.` / `Cash denomination is required: the notes taken or given.` | `VALIDATION_FAILED` / `DENOMINATION_REQUIRED` |
| SETTLE: 0 < amount ≤ still due | `The amount must be more than ₹0 and at most ₹….` | `BAD_REQUEST` |
| SETTLE: notes total = amount | `The notes' total (₹…) must equal the amount (₹…).` | `DENOMINATION_MISMATCH` |
| SETTLE `TO_GIVE`: counts ≤ drawer | `Not enough ₹100 notes in the drawer.` | `DRAWER_TOO_FEW_NOTES` |
| nothing below 0 after the move | `That's more than your cash in hand (₹…).` / `… the cash in account …` | `INSUFFICIENT_CASH_IN_HAND` / `…_IN_ACCOUNT` |
| CANCEL: the side that goes down has it | `Not enough cash in hand to cancel it (₹…).` / `Not enough cash in account to cancel it (₹…).` | `INSUFFICIENT_CASH_TO_CANCEL` |

→ SETTLE 200 `Due settled.` or `₹300 is still due.`; CANCEL 200 `Due cancelled.`; both `data: { due, cash }`. Part payment keeps it OPEN with the rest.

**Ledger:** `DUE_CREATED`, `DUE_SETTLED`, `DUE_CANCELLED` entries carry `cashInHandChange`, `cashInAccountChange`, `cashOtherChange`, `cashDueExtraChange` for the move, and `remarks` like `To collect · added to cash in hand · Pays tomorrow`. They're in `today.transactions` (show them as they are).

**Totals:** the heartbeat `cash.dues` **and** the cash screen `dues` (your point 4) are `{ toCollect, toGive, openCount, bySide: { CASH_IN_HAND: { toCollect, toGive }, CASH_IN_ACCOUNT: {…}, OTHER_CASH: {…} } }`. "Float with dues" stays a desktop calculation.

### 22.3 Cash exchange (your 6.5)

**`POST /machines/runtime/cash/exchanges`** `{ …credentials, "taken": { "notes500": 1 }, "given": { "notes100": 5 }, "note"?: "…" }` → **201** `Cash exchange saved.` `data: { id, taken, given, amount, note, createdAt }`.

Errors (400): `Enter the notes taken from the customer.`, `Both sides must be equal: taken ₹…, given ₹….`, `Not enough ₹100 notes in the drawer to give.` (the notes just taken count as available), not set up. Drawer only: cash in hand and cash in account don't change. Ledger `EXCHANGE` (`cashInHandChange` 0, `drawerChange` = the net swap, `remarks` = `5 × ₹100 → 1 × ₹500 · <note>`).

**`GET /machines/runtime/cash/exchanges?date=YYYY-MM-DD`** (IST, default today) → `data: [ … ]`, newest first.

### 22.4 Close the day (your 6.3)

**`POST /machines/runtime/cash/day-close`** `{ …credentials, "countedCashInHand": 58500, "countedDrawer": { all 12 keys } }`

| Rule | Error |
|---|---|
| all 12 keys, integers 0–100,000 | 400 (zod message for the missing key) |
| `countedCashInHand` = notes total | 400 `The cash in hand you entered (₹…) must equal the notes counted (₹…).` |
| today (IST) not closed yet | 409 `Today is already closed.` |
| pool set up | 400 `Cash management isn't set up for this CSP yet. …` |

→ **201** `Day closed. The count matches.` / `Day closed. You're ₹500 short.` / `… over.`, `data: { dayId, agentId, date: "2026-11-02", system: { cashInHand, drawer }, counted: { cashInHand, drawer }, difference, closedAt }`. Balances don't change. Ledger `DAY_CLOSE` (`remarks` `Matched` / `₹500 short` / `₹500 over`). When `difference ≠ 0`, send the correction request (§21.4) as you planned, unless `cash.lastRequest.status` is `PENDING` (409 otherwise).

**`GET /machines/runtime/cash/day-close?date=YYYY-MM-DD`** (default today) → `data: <same object>` or `null`. Today's cash screen also has **`dayClose`** (same object or `null`), so you don't need a second call to show "Day closed HH:mm".

### 22.5 History for older days (your 6.4)

**`GET /machines/runtime/cash/days?from=2026-10-20&to=2026-11-02`** (or `POST /machines/runtime/cash/days` with `{ …credentials, "from", "to" }`) → `data: [ { date, status: "OPEN"|"CLOSED"|"NOT_CLOSED", closedAt, difference } ]`, newest first. Default the last 14 days, ≤ 92 per call; `to` after today is cut to today; 400 `` `from` must be on or before `to`. `` / `Use a date like 2026-11-02.`

**`GET /machines/runtime/cash?date=2026-11-01`** → the §21.6 shape for that day, with:
- `cashInHand`, `drawer`, `cashLimit`, `cashInAccount`, `cashInTransit`, `cashLeftInBank`, `cashOther` = the balances at the **end** of that day;
- `today.totals` / `today.transactions` = that day's entries; `today.settlements` = that day's finished steps;
- `openSettlements: []` for a past day; `dayClose` when it was closed;
- new: `day` (`YYYY-MM-DD`) and `isToday`.

`today.totals` now also has `customIn`, `customOut`, `duesCollected`, `duesGiven`. `transactions[]` items have `cashOtherChange`. New `type` values: `CUSTOM`, `DUE_CREATED`, `DUE_SETTLED`, `DUE_CANCELLED`, `EXCHANGE`, `DAY_CLOSE` (plus `SETTLEMENT_HELD` from §21.7).

### 22.6 Tasks (your 6.6)

Task: `{ id, agentId, agentName, title, note, dueAt, done, doneAt, createdBy: "KO"|"CSP", createdAt, updatedAt }`.

| Call | Body | Answer |
|---|---|---|
| `GET /machines/runtime/cash/tasks?status=OPEN\|DONE\|ALL` (default ALL) | — | `data: [ … ]`: open (soonest due, then no due time, oldest first), then done in the last 30 days (newest first) |
| `POST /machines/runtime/cash/tasks` | `{ title, note?, dueAt? }` | 201 `Task added.` `data: <task>` (`createdBy: "KO"`) |
| `PATCH /machines/runtime/cash/tasks/:id` | any of `{ title, note, dueAt, done }` | 200 `Task updated.` |
| `DELETE /machines/runtime/cash/tasks/:id` | credentials (headers or body) | 200 `Task deleted.` |

Errors: 400 `Write what needs doing.` / `Keep it under 100 characters.` / `Keep the note under 300 characters.` / `Use an ISO date and time.`; 404 `That task isn't there any more.`; 403 `This task is from your CSP. Only they can change it.` (a CSP task: only `done` can change, and it can't be deleted). `note: null` or `dueAt: null` clears them. The server doesn't log task text.

### 22.7 Calls, all machine-authenticated for the PC's assigned agent

| Method | Path | Section |
|---|---|---|
| GET / POST | `/machines/runtime/cash/labels` | 22.1 |
| POST | `/machines/runtime/cash/custom-transactions` | 22.1 |
| GET / POST | `/machines/runtime/cash/dues` | 22.2 |
| GET / POST | `/machines/runtime/cash/dues/:id` | 22.2 |
| GET / POST | `/machines/runtime/cash/exchanges` | 22.3 |
| GET / POST | `/machines/runtime/cash/day-close` | 22.4 |
| GET / POST | `/machines/runtime/cash/days` | 22.5 |
| GET | `/machines/runtime/cash?date=` | 22.5 |
| GET / POST | `/machines/runtime/cash/tasks` | 22.6 |
| PATCH / DELETE | `/machines/runtime/cash/tasks/:id` | 22.6 |

GETs and DELETE take the credentials in headers (`X-Machine-Code`, `X-Machine-Fingerprint`, `Authorization: Machine <apiKey>`, or signed); POST / PATCH in the body or headers. Common errors on all of them: 403 `This plan doesn't include cash management.`, 403 `No agent is currently assigned to this machine.`, 400 `This agent isn't part of a CSP.`, machine-auth errors (section H), 429 rate limit (shared with the other runtime calls).

### 22.8 Desktop to-do: what to change, where

| Screen / file (your names) | Change |
|---|---|
| `Services/CashExtrasService.GetLabelsAsync` | `GET /cash/labels`; keep only `active` |
| `Services/CashExtrasService.CreateCustomTransactionAsync` ("New transaction" popup) | `POST /cash/custom-transactions`; show `message`; update the strip and `machineConfig.json` from `data.cash`; add `data.due` to Balance due when not null |
| `Services/CashExtrasService.GetDuesAsync` / `CreateDueAsync` / `SettleDueAsync` / `CancelDueAsync` (Balance due tab + Overview card) | 22.2. "Add balance due" from a receipt: send its `receiptId` (and the notes if cash is handed back or taken out); re-read cash afterwards (⚠ 3). Settle: denomination popup, total = amount |
| `Services/CashExtrasService.CreateExchangeAsync` / `GetExchangesAsync` (Settlement tab "Cash exchange") | 22.3; refresh the drawer afterwards |
| `Services/CashExtrasService.CloseDayAsync` / `GetDayCloseAsync` ("Close the day") | 22.4; after a short / over close, send the correction request (21.4) unless one is pending; show "Day closed HH:mm" from `dayClose` on the cash screen |
| `Services/CashExtrasService.GetDaysAsync` / `GetDayAsync` (History tab) | 22.5 |
| `Services/CashTaskService.GetTasksAsync` / `SaveAsync` / `SetDoneAsync` / `DeleteAsync` (Tasks tab) | 22.6; remove the local tasks file and the sample "from the CSP" task; for `createdBy: "CSP"` show only the done tick |
| Overview / controller strip | add "Other cash" (`cashOther`) and dues (`cash.dues`) from the heartbeat |
| Setup window (activation, step 2) | handle `data.cash.status = "SAVED"` (show "Saved; applies when your CSP sets up cash management") |
| Every cash call | 403 `This plan doesn't include cash management.` → hide cash management, don't lock the app |

### 22.9 Answers to your 6.8 (rev 21, 2026-11-03)

| # | Your point | Answer |
|---|---|---|
| 1 | Receipt dues and the drawer | Confirmed as you apply them: for `TO_COLLECT` the notes not received come **out** of the drawer (each count ≤ the drawer), for `TO_GIVE` the notes not paid out go **back in**. **`cashDenomination` is now required** for a receipt due whose cash was applied (400 `DENOMINATION_REQUIRED`), total = amount. Settling adds / takes the settle's notes, so the drawer ends right. A cancel before any payment puts the same notes back. See 22.2. |
| 2 | Which receipts can have a due | Any stored receipt of the agent (retention period), any day. Cash moves only for one whose cash was applied; a `RECEIPT_NOT_APPLIED` or non-cash receipt gets a due that moves nothing and needs no notes. Your choice (today's applied cash receipts) is fine. |
| 3 | `dueAt` format | `2026-11-03T11:00:00.000Z` is accepted; so are `+05:30` / `+00:00` offsets and no milliseconds. The answer always has UTC `…Z`. |
| 4 | Dues in `GET /cash` | Added: `dues` on the cash screen, same object as the heartbeat `cash.dues`, now with `bySide`. |
| 5 | Dev server | 192.168.1.4 (your note). |
| 6 | Idempotency key | **Done** on every desktop cash write: `POST /cash/settlements`, `/cash/settlements/:id`, `/cash/requests`, `/cash/custom-transactions`, `/cash/dues`, `/cash/dues/:id`, `/cash/exchanges`, `/cash/day-close`, `/cash/tasks`, `PATCH` / `DELETE /cash/tasks/:id`. Header `Idempotency-Key` (8–128 of letters, digits, `- _ : .`; a new random id per user action, the same on every retry). Kept 24 h per machine. A retry gets the **first answer again** (same status and body) with header `Idempotent-Replayed: true`; nothing runs twice. Only successful answers are kept: after an error the retry runs again. While the first copy is still running, a second one gets 409 `IDEMPOTENCY_IN_PROGRESS` (retry a moment later); the same key on a different call → 409 `IDEMPOTENCY_KEY_REUSED`. No header = as before. |
| 7 | Speed | Cash reads no longer run inside a database transaction (their queries now run in parallel), the cash screen's queries are merged into one round, and the machine's API key check is remembered for 10 minutes (bcrypt was ~100 ms per call). Measured from a server talking to the same remote database (Neon, Singapore) as your test server: `GET /cash` ~0.9–1.8 s → **~0.5–0.7 s**, `/cash/dues` ~0.3 s, `/cash/labels` ~0.4 s, `/cash/days` ~0.3 s. What's left is mostly network round trips to the database: production with the API next to the database should be well under 500 ms. |
| 8 | Due: the KO chooses where the amount goes | **Done** as you wrote it, with one addition: extra cash held by dues (`cashDueExtra`) keeps the books balanced when other cash moves alone. See 22.2 for the table, messages, `cash` and checks. |
| 9 | Settlement request in one object | **Done.** Every step (open, finished, in `openSettlements`, `today.settlements`, the CSP feed and every settlement answer) has `requestId` (step 1's id, same for both steps), `requestStartedAt`, `stepNumber` (1 or 2), `stepCount` (2; 1 for `BANK_TO_HAND`), and `previousStep: { id, approvedAt, amount }` on a step 2 (`null` otherwise). |
| 10 | Heartbeat: what's waiting | **Done.** Heartbeat `cash` has `openSettlement: { id, requestId, direction, step, stepNumber, stepCount, amount, label, needsDenomination } \| null` and `tasks: { openCount, overdueCount, newFromCspCount }`. `newFromCspCount` counts open CSP tasks added since the KO last read the task list (`GET /cash/tasks` resets it). |
| 11 | Error codes | **Done.** Every error answer is `{ success: false, code, message }`. The codes you listed exist (names in the table below), plus a status code when nothing specific applies (`BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `VALIDATION_FAILED`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`). Upload answers: each `skippedReceipts[]` item also has `code`: `RECEIPT_ALREADY_EXISTS`, `DUPLICATE_IN_REQUEST`, `OLDER_THAN_RETENTION`, `INVALID_RECEIPT`. |
| 12 | Exchange in history | **Done.** `EXCHANGE` remarks: `1 × ₹500 → 5 × ₹100` (`· <note>` after it when given; coins as `3 × ₹2 coin`). |
| 13 | Default labels | **Done.** A new pool starts with **Other** (`BOTH`), **Shop expense** (`OUT`), **Bill collection** (`IN`), **Recharge** (`IN`); the CSP renames or deactivates them. Pools set up before rev 21 have none: the CSP adds them in the app. |
| 14 | `originalAmount` | Kept on every due. |

**Error codes** (`code` → when):

| Area | Codes |
|---|---|
| Cash management | `PLAN_NO_CASH_MANAGEMENT`, `CASH_NOT_SET_UP`, `NOT_PART_OF_CSP`, `NO_AGENT_ASSIGNED`, `INSUFFICIENT_CASH_IN_HAND`, `INSUFFICIENT_CASH_IN_ACCOUNT`, `INSUFFICIENT_LEFT_IN_BANK`, `INSUFFICIENT_CASH_TO_CANCEL`, `DENOMINATION_MISMATCH`, `DENOMINATION_REQUIRED`, `DRAWER_TOO_FEW_NOTES`, `SETTLEMENT_ALREADY_OPEN`, `STEP_ALREADY_APPROVED`, `STEP_ALREADY_CANCELLED`, `SETTLEMENT_NOT_FOUND`, `DAY_ALREADY_CLOSED`, `REQUEST_ALREADY_PENDING`, `REQUEST_ALREADY_REVIEWED`, `DUE_NOT_OPEN`, `DUE_NOT_FOUND`, `RECEIPT_DUE_ALREADY_OPEN`, `RECEIPT_NOT_FOUND`, `LABEL_NOT_AVAILABLE`, `LABEL_DIRECTION_NOT_ALLOWED`, `LABEL_NAME_TAKEN`, `TASK_FROM_OTHER_SIDE` (your `TASK_FROM_CSP`), `TASK_NOT_FOUND`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS` |
| Machine auth (section H) | `MACHINE_NOT_FOUND`, `NO_ACTIVE_ACTIVATION`, `SIGNATURE_REQUIRED`, `SIGNATURE_INVALID`, `SIGNATURE_CLOCK_SKEW`, `SIGNATURE_REPLAYED`, `API_KEY_REQUIRED`, `API_KEY_INVALID`, `FINGERPRINT_MISMATCH`, `CREDENTIALS_MISMATCH`, `MACHINE_INACTIVE`, `MACHINE_DELETED`, `ACTIVATION_INACTIVE`, `ACTIVATION_EXPIRED`, `REACTIVATION_REQUIRED`, `SUBSCRIPTION_INACTIVE`, `SUBSCRIPTION_EXPIRED`, `WATCHER_DISABLED`, `WATCHER_NOT_ALLOWED`, `NO_ACTIVE_SESSION`, `AGENT_NOT_VALID` |
| Generic | `RATE_LIMITED` (429), `NOT_FOUND`, `VALIDATION_FAILED`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`, … |

Codes stay the same when a message is reworded; switch to `code` and keep the text match only as a fallback, as you planned.

**Desktop to-do for rev 21:**
- Due without a receipt: keep sending `cashSide`; show `message` and refresh from `data.cash` (it now has `cashInAccount`, `cashOther`, `cashDueExtra`).
- Receipt due: keep sending the notes (now required).
- Limit bar: subtract `cashDueExtra` too (formula in 22.2); show it next to other cash ("Extra cash held by dues").
- Settlements: build the tracker from `requestId`, `stepNumber`, `stepCount`, `previousStep`.
- Strip: `cash.openSettlement` ("waiting for your approval") and `cash.tasks` (badge for `newFromCspCount`, overdue).
- Errors: switch to `code`; send `Idempotency-Key` on every cash write.
- The 4 default labels exist for new pools; "Your CSP hasn't made any labels yet" stays for older ones.

## 23. Optional receipt fields, session timeout, commission (rev 23) — READY

### 23.1 Optional receipt fields (the super admin decides)

Most receipt fields are optional. **Which optional fields the desktop may send is set by the super admin** (admin console), not by a release. The list comes in **both** the heartbeat and the entitlements answer:

```json
"receiptFields": { "allowed": ["rrn", "stan", "terminalId", "location", "bankName", "customerName"] }
```

**What to build:**

1. **Save it in `machineConfig.json`** on every heartbeat (and from entitlements), e.g. `"ReceiptFields": ["rrn", "stan", "terminalId", "location", "bankName", "customerName"]`. The heartbeat carries changes: a field the super admin switches on reaches every PC within one heartbeat (≤ 60 s) and needs no release or re-activation. Offline, use the last saved list.
2. **Read the fields from the SBI receipt** as you do today, then put on the upload **only** the ones in the saved list. Leave out a field you couldn't read (don't send `null` or `""`).
3. **Send them on each receipt** of `POST /receipts/upload-counts` (and `/receipts/upload`), next to the required fields.

| Field | Type | Default | Notes |
|---|---|---|---|
| `rrn` | string | allowed | |
| `stan` | string (≤ 50) | off (rev 24) | |
| `terminalId` | string (≤ 50) | off (rev 24) | |
| `location` | string | allowed | |
| `bankName` | string (≤ 100) | off | |
| `bankTransactionId` | string (≤ 100) | off | the bank's transaction id |
| `bankResponseCode` | string (≤ 50) | off | |
| `bankResponseMessage` | string (≤ 500) | off | |
| `balanceAfter` | number | off | personal |
| `customerName` | string (≤ 200) | off | personal |
| `customerAccount` | string (≤ 50) | off | personal; send it **masked** (e.g. `XXXX1234`) |

Example receipt with the list above:

```json
{ "receiptId": "R-1", "receiptType": "AEPS", "transactionCategory": "CASH_WITHDRAWAL",
  "transactionType": "Cash Withdrawal", "transactionAt": "2026-11-04T05:10:00.000Z", "count": 1,
  "amount": 2000, "cashDenomination": { "notes500": 4 },
  "rrn": "123456789012", "stan": "004512", "location": "Market branch", "bankName": "SBI", "customerName": "Asha" }
```

- **Receipts may differ:** one receipt may have more fields than another (what SBI showed, what the list allowed at that moment). That's expected; send what you have.
- The server keeps only allowed fields and **silently drops** the rest: the receipt is still accepted and counted, nothing is refused. An older desktop that sends more doesn't break.
- **Never send Aadhaar** in any form: there is no such field and never will be.
- The CSP app shows each receipt's fields with their names, so a field switched on later just appears there.

### 23.2 Session timeout: one missed heartbeat

A machine session is on while heartbeats arrive with **at most one missed**: the server ends it (and the PC shows offline) after **120 s** without a heartbeat (`heartbeatTimeout: 120`, was 180). The same applies to the SBI activity session (`/activity/*`). Keep the 60 s heartbeat; if a heartbeat fails, retry it once within the minute. The CSP sees online time, active (SBI) time and late / early per KO in the app (mobile KT §13C).

### 23.3 Commission

The server computes the CSP's commission on every successful receipt at upload (rates set by the super admin; only the CSP earns, KOs are salaried). Nothing for the desktop to send or show; it isn't in any desktop answer.

## 24. Slip image, fixed default fields, grace period (rev 24) — READY

### 24.1 Receipt fields: fixed defaults + extras

Only **`rrn` and `location` are fixed defaults**: always in `receiptFields.allowed`, the super admin can't switch them off. **`stan` and `terminalId` are now optional** (off by default, like the rest): send them only when they're in the list. The super admin adds extras from a multi-select (`stan`, `terminalId`, `bankName`, `bankTransactionId`, `bankResponseCode`, `bankResponseMessage`, `balanceAfter`, `customerName`, `customerAccount`, **`slip`**). Nothing changes in how you use the list (§23.1): save it, send only those fields. **`slip` is not a field on the receipt JSON**: it means "upload the slip image" (24.2). Don't put `slip` in the upload body.

### 24.2 Slip image (only when `receiptFields.allowed` contains `"slip"`)

After the receipt itself has been uploaded and **saved** (it's in `inserted` of the upload answer, or in `skipped` with `RECEIPT_ALREADY_EXISTS`), upload a picture of the SBI slip in three steps. Same machine credentials as `upload-counts` (body, or headers / signed request, §19):

1. **`POST /api/v1/receipts/slip/upload-url`** `{ machineCode, apiKey?, fingerprint, receiptId, contentType: "image/jpeg" | "image/png" | "image/webp" }` →
   ```json
   "data": { "receiptId": "R-1", "key": "receipt-slips/KO-0012/2026/11/<id>-<uuid>.jpg",
             "uploadUrl": "https://<bucket>.s3.<region>.amazonaws.com/", "fields": { "key": "…", "Content-Type": "image/jpeg", "Policy": "…", "X-Amz-Signature": "…", … },
             "maxSizeBytes": 2097152, "expiresIn": 300 }
   ```
2. **Upload straight to S3** (not to the API): `multipart/form-data` **POST** to `uploadUrl` with **every** entry of `fields` as form fields (in any order), then the file last as the form field **`file`**. No auth header. S3 answers **204**. The image must be ≤ **2 MB** and of the `contentType` you asked for (else S3 answers 403). The URL is valid **5 minutes**: if it expired, ask for a new one.
3. **`POST /api/v1/receipts/slip`** `{ machineCode, apiKey?, fingerprint, receiptId, key }` (the `key` from step 1) → 200 `Slip saved.` `data: { receiptId, hasSlip: true, slipUploadedAt }`. Sending a new slip for the same receipt replaces the old one. Calling it again with the same key is fine (same answer).

Errors (all have a `code`, §22.9): 403 `Receipt slips aren't enabled. Ask the super admin to allow the slip field.` (`slip` not in the list: stop uploading slips); 404 `Receipt not found. Upload the receipt before its slip.` (upload the receipt first; `receiptId` must be from **this** PC); 400 `Only JPEG, PNG and WebP images are allowed.`; 400 `This slip key doesn't belong to this receipt.`; 400 `The slip hasn't been uploaded yet.` (step 2 failed: retry it). The usual machine-auth errors apply (§6).

**What to build:** compress the slip (JPEG, ~1200 px on the long side, quality ~70, usually 100–300 KB); keep a small **slip queue** next to the receipt queue (receiptId, file path, attempts) and retry with backoff; drop the image file after step 3 succeeds or after 7 days. Never block or delay the receipt upload for a slip. Slips count against the machine runtime rate limit (120 / min), so send at most a few per minute in a backlog. The CSP app shows "View slip" when it exists; the server deletes slips with their receipts after the retention period.

### 24.3 Grace period

**Rev 26: the grace period applies to BC plans only.** CSP plans always have `graceEndsAt: null` and stop at `endDate` until the mandate renewal succeeds (#25). For BC plans: the super admin can now set a **grace period** (0 days today, up to 30). During grace — after `subscription.endDate`, until `subscription.graceEndsAt` (in the heartbeat and entitlements; `null` = no grace) — **the PC keeps working**: heartbeats, uploads and cash calls are accepted, although `activation.expiresAt` (= the end date) has passed, and an unused code can still be activated (or a PC re-activated). After `graceEndsAt` the usual `400 SUBSCRIPTION_EXPIRED` (§6). Desktop to-do: when `endDate < now ≤ graceEndsAt`, show a banner "Subscription expired — renew before <graceEndsAt> to keep this PC working"; don't stop the watcher on `endDate` or `activation.expiresAt` yourself — let the server decide.

### 24.4 Nothing else changes for the desktop

GST on subscriptions, forgot / change password, blocking a user (the CSP's app login; **PCs keep working**, they don't use the login), problem reports and receipt PDFs are app / server only.

---

## 25. Plan blocking: what the desktop shows and when (rev 25) — READY

### 25.1 The rules (product owner, 2026-11-07)

- CSP subscriptions now **renew automatically by UPI mandate** at the plan's end date/time. A failed charge is retried twice, 15 minutes apart; after the 3rd failure (or when the CSP removed the mandate) the subscription **stops at once — no grace**. **Rev 26: while the charge is being tried (from the end date until a charge succeeds, ~30 min at most) the PCs are blocked too** — machine auth answers 400 `SUBSCRIPTION_EXPIRED`; a successful charge extends `endDate` and the next heartbeat goes through. A cancelled subscription works until its end date, then stops.
- When the subscription has stopped, **nobody may get any benefit from the service**: the SBI automation and the cash management must stop on every PC of that CSP (and its KOs) immediately.
- On the ₹250 `CSP_AUTOMATION` plan there is **no cash management** on the desktop at all.

### 25.2 How the desktop knows

| Signal | Meaning | Action |
|---|---|---|
| Heartbeat (every 60 s) succeeds, `subscriptionStatus: "ACTIVE"` | running | normal UI |
| Heartbeat `endDate < now ≤ graceEndsAt` | BC plan in grace (CSP plans never have grace since rev 26) | keep working; banner "Subscription expired — renew before <graceEndsAt>" |
| 400 `SUBSCRIPTION_EXPIRED` right after `subscriptionEndDate` on a CSP plan | renewal being charged / retried (rev 26: **blocked** meanwhile) | block (25.3) like any stop. Optional: while `now − subscriptionEndDate` < 45 min (cached), show "Your plan's renewal payment is being charged. This PC resumes as soon as it goes through." instead of the renew text. Keep heartbeating; it unblocks by itself on success |
| Any runtime call (heartbeat, entitlements, activity, cash, upload-counts) answers **400** with `code` **`SUBSCRIPTION_INACTIVE`** ("Subscription is not active.") or **`SUBSCRIPTION_EXPIRED`** ("Subscription has expired.") or **`ACTIVATION_EXPIRED`** ("Activation has expired.") | stopped (lapsed, expired, cancelled and ended) | **block at once** (25.3); stop queuing new automation runs; keep the receipt queue (don't delete it) |
| Heartbeat `features` has no `CASH_MANAGEMENT` | ₹250 plan | cash management not shown (25.4) |
| 403 `PLAN_NO_CASH_MANAGEMENT` on a cash call | plan changed under you | switch the cash screen to 25.4 |

Classify by `code` (§22.9 / section H), never by text. After a block, keep sending the heartbeat every 60 s (it will keep failing with the same code) so the PC **unblocks by itself within a minute** once the CSP renews or subscribes (the PCs carry over to the new subscription, no re-activation, item #13).

### 25.3 Blocked: replace the automation UI and the cash management UI

**Where:** (a) the **automation** screen (the CSP automation tool / controller: every SBI flow — AEPS, deposit, withdrawal, money transfer, BBPS, passbook, social security …) and (b) the **cash management** panel (today's cash, settlements, custom transactions, dues, exchange, day close, tasks, adjust requests). **When:** at once on the first blocking answer (25.2), also on app start when the last cached state is blocked (until a heartbeat succeeds).

Replace each area **completely** (don't just disable buttons; don't render balances) with:

```
┌──────────────────────────────────────────────────────────────┐
│  Please ask your CSP to renew the service or create a new     │
│  subscription in the mobile app.                              │
│                                                               │
│                     [ View plans ]                            │
└──────────────────────────────────────────────────────────────┘
```

- Same text for automation and for cash management. If an automation run is in progress, let the current SBI step finish (never break a live bank transaction), upload its receipt, then block.
- **[View plans]** opens a read-only plan list inside the desktop: `GET /api/v1/subscriptions/plans?ownerType=CSP` (public, no credentials) → show each plan's `name`, `pricing[].price` / `priceWithGst` "per machine / month" and features, with the note "Subscribe or renew in the CSP Manager mobile app". (Use `portalUrl` instead once it's not null.)
- The SBI kiosk itself stays usable manually (we don't control SBI); only **our** automation and cash management are blocked.
- The receipt watcher / upload queue: uploads are refused while blocked (same 400); keep them queued and retry after unblock.

### 25.4 ₹250 plan (`CSP_AUTOMATION`): no cash management

When `features` lacks `CASH_MANAGEMENT`: hide the cash management panel and every denomination popup (omit `cashDenomination` on uploads, §I). If the panel was open, show in its place: "Cash management isn't in your CSP's plan. Please ask your CSP to upgrade the plan in the mobile app." + **[View plans]**. Automation keeps working.

### 25.5 Machine config

Save on each heartbeat: `subscriptionStatus`, `subscriptionEndDate`, `graceEndsAt`, `features`, and a computed `blocked` flag + `blockedCode` (the last blocking `code`) so a restart offline shows the right screen. Clear `blocked` on the next successful heartbeat.

## 26. Shared PCs: any agent of the CSP, cash follows the SBI login (rev 25) — READY

### 26.1 Rule

A PC is activated for one agent (the CSP or one of its KOs), but **any agent of the same CSP family** — the CSP that owns the subscription and **all its KOs** — may log in to the SBI kiosk on it, and vice versa on their PCs. Agents of **another CSP** may not. Cash management on the desktop must always show **the agent who is logged in to SBI now**: its own cash in hand and drawer (the cash in account is shared by the whole CSP).

### 26.2 `accessAgent` in machineConfig (from the heartbeat)

The heartbeat (and `GET/POST /machines/runtime/cash/session`) now returns:

```json
"accessAgent": ["CSP-001", "KO-001", "KO-002"],
"accessAgents": [ { "agentId": "CSP-001", "name": "Ravi", "type": "CSP", "emailMasked": "ra***@gmail.com", "emailVerified": true },
                  { "agentId": "KO-001",  "name": "Sita", "type": "KO",  "emailMasked": null,               "emailVerified": false } ],
"cashAgentId": "KO-001",            // whose cash the heartbeat `cash` block is (null = the PC's own agent)
"cashLoginMethod": "KIOSK"          // KIOSK | EMAIL_OTP | null
```
Save `accessAgent` (ids) and `accessAgents` in `machineConfig.json` on every heartbeat (the list changes when the CSP adds / deletes / replaces KOs). The `cash` block in the heartbeat is now **the logged-in agent's** cash.

### 26.3 Automatic login after the SBI kiosk fingerprint login (primary)

When an agent completes the SBI kiosk login **with a successful fingerprint verification**, read its agent id from the SBI screen (as today for the activity session) and call **`POST /machines/runtime/activity/start` `{ machineCode, fingerprint, agentId }`** with **that** agent id (not the PC's own). Rev 25 changes:
- Allowed for any id in `accessAgent`; an id outside the family → **403 `AGENT_NOT_IN_FAMILY`** "This agent can't use this PC: only the CSP that owns it and its KOs can." Show it and don't start automation for that login.
- On success the server switches cash management to that agent (`cashAgentId`, method `KIOSK`); the answer adds `cashAgentId`. Reload the cash panel at once (`GET /machines/runtime/cash`) — it now shows that agent's cash in hand, drawer, dues, tasks and adjust requests.
- **`activity/stop`** (SBI logout / auto-logout / app close) ends the kiosk cash login: cash management goes back to the PC's own agent (call `GET /machines/runtime/cash` again, or show the login screen 26.4).
- Receipts uploaded while an agent is logged in carry **that agent's id** (`upload-counts` `agentId`, item #29); the server accepts any id of the family.

### 26.4 Fallback: email OTP login (before the kiosk login, or when the automatic one fails)

Cash panel → "Log in to cash management":

1. Dropdown of `accessAgents` (name + id). Disable entries with `emailMasked: null` ("No email — ask your CSP to add it in the app").
2. **`POST /machines/runtime/cash/login/otp` `{ machineCode, fingerprint, agentId }`** → 200 `OTP sent to the agent's email.` `data: { sentTo: "ra***@gmail.com", expiresInSeconds: 600 }`. Errors: 400 `AGENT_EMAIL_MISSING`, 403 `AGENT_NOT_IN_FAMILY`, 400 `Please wait N seconds before asking for a new OTP.` (60 s between sends), `Too many OTPs sent. Try again in an hour.` (5 / hour).
3. **`POST /machines/runtime/cash/login/verify` `{ machineCode, fingerprint, agentId, otp }`** (6 digits) → 200 `Logged in to cash management.` `data: { cashAgent: { agentId, name, type, emailMasked, emailVerified: true }, loginMethod: "EMAIL_OTP", cash: { … same as heartbeat cash … } }`. Errors: `Invalid OTP.` (5 tries), `OTP has expired. Ask for a new one.`, `Maximum OTP attempts exceeded. Ask for a new one.`, `OTP not found. Ask for a new one.` A successful login OTP also marks the agent's email verified.
4. **`POST /machines/runtime/cash/logout`** → back to the PC's own agent. An email OTP login stays until logout or until a different agent's kiosk login replaces it.

**`GET /machines/runtime/cash/session`** (or POST with credentials) → `{ cashAgent, loginMethod, accessAgents }` — call it on app start to show who is logged in.

### 26.5 Email verification (KOs)

KOs have no app login; their email (entered by the CSP in the app) is verified by OTP **on the desktop**:
- At PC activation (item #27.3), or
- In the cash panel when the logged-in agent's `emailVerified` is false: banner "Verify your email to use email login" → **`POST /machines/runtime/cash/email/otp` `{ machineCode, fingerprint, email? }`** (`email` to set / correct it; omitted = the saved one) → **`POST /machines/runtime/cash/email/verify` `{ machineCode, fingerprint, otp }`** → `{ agentId, emailVerified: true }`. Both act on the **logged-in cash agent**. The CSP changing the email in the app clears the verification (verify again).

> **Email delivery:** the server's email sender is still a console stub (pre-production checklist); in development read the OTP from the API log.

## 27. Activation form: pre-fill, difference source, KO email (rev 25) — READY

### 27.1 Pre-fill: `POST /api/v1/machines/activate/preview`

After the user typed `agentId`, activation code and password (before the cash step), call `POST /api/v1/machines/activate/preview` `{ agentId, activationCode, activationPassword }` (public, activation rate limit) → nothing is written:

```json
"data": {
  "agent": { "agentId": "KO-002", "name": "Sita", "type": "KO", "email": "sita@…", "emailMasked": "si***@gmail.com", "emailVerified": false },
  "plan": { "code": "CSP_COMPLETE", "name": "CSP Complete Solution", "cashManagement": true },
  "reactivation": false,
  "cash": { "required": true, "setUp": true, "cashInHand": 60000, "drawer": { "notes500": 0, … }, "drawerTotal": 0,
            "differenceSources": ["CASH_IN_ACCOUNT", "OTHER"] }
}
```
Errors: the same as activation (`Agent not found.`, `Activation code not found.`, `Activation is not assigned to this agent.`, `Invalid activation password.`, …).
- `cash: null` → the plan has no cash management (₹250): **don't show** the cash in hand / denomination step; don't send them.
- Otherwise pre-fill **Cash in hand** with `cash.cashInHand` (the amount the CSP gave this KO in the app), **editable**, and ask for the denomination (total must equal the entered cash in hand, as today).

### 27.2 Counted amount differs: `differenceSource`

If the entered cash in hand ≠ `cash.cashInHand`, show (required) "Where did the ₹<diff> difference come from / go to?":

| Entered vs given | Option shown | Send `differenceSource` | Server |
|---|---|---|---|
| more | "Cash in account" | `CASH_IN_ACCOUNT` | difference taken from the CSP's cash in account |
| more | "Other (cash on hand increased by CSP)" | `OTHER` | only this agent's cash in hand goes up; the CSP's cash limit goes up; CSP notified |
| less | "Cash in account" | `CASH_IN_ACCOUNT` | difference added to the cash in account |
| less | "Other (cash on hand decreased by CSP)" | `OTHER` | only this agent's cash in hand goes down; the limit goes down; CSP notified |

`POST /api/v1/machines/activate` body adds **`differenceSource`**. The agent's new cash in hand is always what it entered; everything is audited. Without it when the amounts differ → **400 `CASH_DIFFERENCE_SOURCE_REQUIRED`** ("The cash in hand you counted (₹55000.00) differs from what the CSP gave you (₹50000.00) by ₹5000.00. Say where the difference came from: differenceSource CASH_IN_ACCOUNT or OTHER."). `CASH_IN_ACCOUNT` larger than the cash in account → 400 `INSUFFICIENT_CASH_IN_ACCOUNT` ("… Choose OTHER if the CSP brought this cash in."). The activation answer's `data.cash` adds `difference` and `differenceSource`. Activation also completes any open Adjust request of the agent (the drawer was just counted).

On a plan **without** cash management, `cashInHand` / `cashDenomination` are no longer required for a KO (and are ignored if sent).

### 27.3 KO email at activation

In the activation form show the agent's email (`agent.email`, editable) with **[Verify]**: `POST /api/v1/machines/activate/email/otp` `{ agentId, activationCode, activationPassword, email? }` → `{ sentTo, expiresInSeconds }`, then `POST /api/v1/machines/activate/email/verify` `{ agentId, activationCode, activationPassword, otp }` → `{ agentId, emailVerified: true }` (saves the email). Optional: the KO may skip and verify later in the cash panel (26.5); it needs a verified email for the email OTP cash login.

### 27.4 One activation per agent

Activating a second code for an agent that already has a **running** activation on another PC → 400 **`AGENT_ALREADY_HAS_ACTIVATION`** "This agent already has a running activation (CODE on MC-…). Ask the owner to revoke it first." Show the message; no retry. (The app no longer lets the owner assign a second code to the same agent.)

## 28. Adjust requests (mandatory) and the one-step cash transfer (rev 25) — READY

### 28.1 Adjust requests

When the CSP changes an agent's cash in hand in the app — moving cash between agents while adding a KO, editing cash in hand directly, or **increase / decrease** — the server creates an **Adjust request** for that agent. It's **mandatory**: until it's done, the agent's cash writes (settlements, transfers, custom transactions, dues, exchange, day close, change requests) are refused with **409 `ADJUSTMENT_PENDING`** "Count the notes for your CSP's cash change first (Adjust request)." Receipts still upload and apply.

- Shown in the heartbeat `cash.pendingAdjustments` (oldest first) and `GET /machines/runtime/cash/adjustments` (`?status=ALL` for history):
  ```json
  { "id": "…", "agentId": "KO-001", "source": "CSP_DECREASE", "status": "PENDING", "kind": "TAKEN", "amount": 10000,
    "cashInHandBefore": 60000, "cashInHandAfter": 50000, "drawerBefore": { "notes500": 120, … }, "mandatory": true,
    "remarks": "Took cash back", "createdAt": "…" }
  ```
- **UI:** when the logged-in cash agent has any pending item, open a **modal that can't be dismissed** (above the cash panel; automation may keep running): "Your CSP **took ₹10,000** from your cash in hand (₹60,000 → ₹50,000). Count the notes you **handed over**." (`kind: GIVEN` → "gave you ₹… — count the notes you **received**"). **[Adjust]** opens the denomination modal pre-filled with the current drawer (`drawerBefore` / heartbeat `cash.drawer`).
- **Complete:** `POST /machines/runtime/cash/adjustments/:id/complete` with **either** `{ notes: { notes500: 20 } }` (only the notes handed over / received; the server subtracts for TAKEN, adds for GIVEN) **or** `{ drawer: { …full count… } }`. The resulting drawer total must equal the agent's **current** cash in hand → else 400 `DENOMINATION_MISMATCH` "The notes' total (₹…) must equal your cash in hand (₹…)." → 200 `{ cashInHand, drawer, drawerTotal }`. Completing one completes **all** the agent's open requests (the drawer now matches). 409 `ADJUSTMENT_NOT_PENDING` if done already.
- Several pending: show the sum ("₹30,000 taken in 2 changes") and one Adjust.

### 28.2 Simplified cash in hand ⇄ cash in account (one step)

The two-step settlement (account → bank → hand, item #21.7) stays for the bank-trip case, but the **default** "Move cash" button is now **one step**:

`POST /machines/runtime/cash/transfer` `{ machineCode, fingerprint, direction: "HAND_TO_ACCOUNT" | "ACCOUNT_TO_HAND", amount, cashDenomination: { …notes moved… }, remarks? }` (+ `Idempotency-Key`) → 201 `Moved to cash in account.` / `Moved to cash in hand.` `data: { cashInHand, cashInAccount, drawer, drawerTotal }`.
- `cashDenomination` total must equal `amount` (400 `DENOMINATION_MISMATCH`); HAND_TO_ACCOUNT: the notes must be in the drawer (400 `DRAWER_TOO_FEW_NOTES`), amount ≤ cash in hand; ACCOUNT_TO_HAND: amount ≤ cash in account (400 `INSUFFICIENT_CASH_IN_ACCOUNT`). Cash limit unchanged. Ledger `TRANSFER`.
- **UI:** one form: direction toggle "Hand → Account" / "Account → Hand", amount, denomination, [Move]. Put "Bank trip (2 steps)" behind "More".

## 29. Failed receipts and the uploading agent (rev 25) — READY

- **Bug found in testing:** a transaction that completed in automation but whose **SBI receipt page shows FAILED** was uploaded as a success, so commission and the cash ledger were applied. **Desktop fix:** read the status on the receipt page; **don't upload** failed ones, and send **`status`** on every receipt in `upload-counts`: `"SUCCESS"` (default when omitted), `"FAILED"` or `"PENDING"`.
- **Server (done):** a receipt with `status` other than `SUCCESS` is **skipped** — no count, no commission, no cash — with `skipped[].reason: "Failed transaction: not recorded."`, `code: "FAILED_TRANSACTION"` (treat as done, don't retry).
- **`agentId`** in `upload-counts` = the agent **logged in to SBI** for that transaction (item #26). Any id in `accessAgent` is accepted; another CSP's agent → 403 `AGENT_NOT_IN_FAMILY`.

## 30. Automation fixes from testing (rev 25) — READY (desktop only)

These were reported by the product owner on 2026-11-07. The server needs nothing for them except where noted.

| # | Problem | Required behaviour |
|---|---|---|
| 30.1 | **AEPS:** after the transaction password, the **Proceed** button isn't clicked; after a **successful fingerprint**, the Proceed button isn't clicked | Wait for each Proceed button to be visible + enabled (poll ≤ 10 s, 200 ms), click it, then verify the next screen appeared; retry the click once; on failure stop the run with "Couldn't continue after <step>" (30.3). |
| 30.2 | **AEPS GPS device selection takes too long** | Select the device directly (by its value / index from the cached list) instead of scanning the dropdown; cache the last selected device per PC in machineConfig; cap the wait at 3 s and log the time taken. |
| 30.3 | SBI shows a **red error text below a field** | Before every "Proceed / Submit", and after it, scan the form for SBI's red validation / error labels. If any is visible: **stop the automation** for this run, don't submit, and show the error text (with the field name) in the CSP automation tool ("SBI says: <text>"). Log it. |
| 30.4 | Completed run but the **receipt page says FAILED** | Don't upload it as a success (item #29); show "Transaction failed at SBI" in the run log and the recent list. |
| 30.5 | **Print receipt:** the print-preference dialog appears and 3 prints come out (2 blank / extra-large, the last correct) | Print **once**, silently, with the existing printer setup and **"scale to fit"** (fit to page width); suppress the preferences dialog (set the print settings programmatically); never send the page more than once; no extra blank pages. |
| 30.6 | **Recent transactions** on the desktop cash automation screen list every receipt | Default filter = only receipts that came **from the transaction automation** (runs done by our tool). The **History** screen keeps showing all receipts by default (unchanged). |
| 30.7 | **Money transfer, account mode:** the account number the customer gives (savings) can have a **linked current account**, and the customer wants the money in the current account; SBI then lists more than one account in the beneficiary step | When the beneficiary lookup returns **more than one account**, pause and show a picker (account number, type SAVINGS / CURRENT, name as shown by SBI); select the chosen one in SBI's beneficiary list and deposit **only** to it. Never pick automatically when there are several. Log which one was chosen (masked). |
| 30.8 | **Peri service and Morpho** (fingerprint device) become unresponsive / SBI kiosk errors | Detect (device not responding / known SBI error texts) and **restart the Peri service and the Morpho RD service**, then retry the step once. **PENDING:** the owner will send the exact error texts, service names and when to restart; build a `DeviceRecovery` hook now and wire it when the details arrive. |

## 31. Plans: ₹450 removed (rev 25) — READY

CSP plans are now only `CSP_AUTOMATION` (₹250: `DESKTOP_AUTOMATION`, `RECEIPT_SYNC`) and `CSP_COMPLETE` (₹550: + `CASH_MANAGEMENT`, `MOBILE_TRACKING`). `CSP_AUTOMATION_CASH_MANAGEMENT` (₹450) is inactive: a PC on a running ₹450 subscription keeps its features until it ends or is upgraded. **All cash management features need `CASH_MANAGEMENT` in the heartbeat `features`** (already the rule, §I). Upgrades / renewals never re-activate the PC (item #13).

## 32. KO replaced or deleted (rev 25) — READY

- **Replaced** (CSP in the app): the PC's activation moves to the new KO without re-activation. The next heartbeat / entitlements show the new `machine.agentId` (entitlements) and the new `accessAgent` list; the new KO's cash (moved from the old one) is in `cash`. Update `machineConfig.AgentId` from the heartbeat/entitlements when it changes, end any open activity session of the old KO, and show the login screen (26.4).
- **Deleted:** the KO disappears from `accessAgent`; a cash login of that KO falls back to the PC's agent; its cash management is removed on the server.

## 33. Free trial (rev 27) — READY

New CSP / BC accounts can take a free trial (full CSP Complete features for the trial days). For the desktop it's a normal subscription, with three differences:

- **Heartbeat** adds `subscriptionType` (`"PAID"` / `"TRIAL"` / …) and `isTrial`. While `isTrial`, show a small banner "Free trial — ends <subscriptionEndDate>" (local time). When the trial ends, the usual `400 SUBSCRIPTION_EXPIRED` block (#25) applies; when the owner buys a plan, the PC carries over and the next heartbeat shows `isTrial: false` (no re-activation).
- **Activation** of a trial code (`POST /machines/activate`) is refused when this PC (its fingerprint) or the activating agent ID already took part in **another account's** trial:
  - **409** `TRIAL_ALREADY_USED_ON_MACHINE` "This PC has already been used for a free trial. Buy a plan to activate it."
  - **409** `TRIAL_ALREADY_USED` "This SBI agent ID has already been used for a free trial. Buy a plan to activate it."
  Show the message on the activation screen with a hint "Ask your CSP to buy a plan, then activate with the new code." Don't retry. Re-activating the **same** PC on the same account's trial works as before.
- **The fingerprint must be stable** — it is the trial's PC check. Keep `fingerprint` derived from hardware (board / CPU / disk serials) as today; never include values that change on reinstall (Windows product ID, user name, MAC of virtual adapters), or a reinstall would look like a new PC.

## 34. API change checklist for rev 26–27 (rev 28) — READY

One list of everything the backend changed for the desktop in rev 26 (CSP renewal blocking) and rev 27 (free trial). **No URL was renamed or removed and no request body changed** — only new response fields, new refusal codes and new states. Errors are `{ success: false, code, message }`; branch on `code`, show `message`.

### 34.1 Summary

| # | API | Change | Where in the desktop |
|---|---|---|---|
| 1 | `POST /machines/runtime/heartbeat` (Q2) | new `subscriptionType`, `isTrial` | `HeartbeatService.ApplyResponse`, `MachineConfig`, main window banner |
| 2 | `POST /machines/runtime/entitlements` (Q3) | `subscription.subscriptionType` can be `"TRIAL"` | Plan details screen |
| 3 | `POST /machines/activate` (Q1) | new 409 `TRIAL_ALREADY_USED_ON_MACHINE`, 409 `TRIAL_ALREADY_USED` (trial codes only) | activation screen |
| 4 | all machine runtime calls | a CSP PC gets **400 `SUBSCRIPTION_EXPIRED`** from the plan's end date **until the renewal charge succeeds** (no grace for CSP) | existing "subscription inactive" handling (#6, #25) |

### 34.2 Heartbeat: `subscriptionType`, `isTrial` (new fields)

**Request:** unchanged. **Response 200** adds `"subscriptionType": "PAID" | "TRIAL"` and `"isTrial": true | false`.

| Case | Desktop |
|---|---|
| `isTrial: true` | save both to `MachineConfig`; show a small banner "Free trial — ends <subscriptionEndDate, local time>"; from 1 day left use a warning colour. Everything else works as a paid plan (automation and cash per `features`) |
| `isTrial` turns `false` (owner bought a plan) | remove the banner; **no re-activation** — the PC moved to the paid plan; `planCode` / `features` / `subscriptionEndDate` change on the same heartbeat |
| trial ended | the next runtime call answers **400 `SUBSCRIPTION_EXPIRED`** → "Subscription inactive" screen (#25: "Your free trial has ended. Ask your CSP to buy a plan."), keep heartbeating; when the owner buys a plan or the super admin extends the trial, the next heartbeat succeeds and the PC works again by itself |
| older server without the fields | treat missing `isTrial` as `false` |

### 34.3 Activation of a trial code: new refusals

**Request:** unchanged (section C). The checks run after the password check (rows 12–13 of section C) and only when the code belongs to a **free trial**.

| Response | Meaning | Desktop |
|---|---|---|
| 201 | activated; this PC and the agent ID are now recorded as having had a trial | as before (write `MachineConfig`, heartbeat at once) |
| **409 `TRIAL_ALREADY_USED_ON_MACHINE`** | this PC (fingerprint) already ran **another account's** trial | show `message` on the activation screen + hint "Ask your CSP to buy a plan, then activate with the new code." Don't retry; keep the form |
| **409 `TRIAL_ALREADY_USED`** | the agent ID typed already took part in another account's trial | same message / hint |
| same PC, same account's trial again | allowed (re-activation, item #15) | as before |

`POST /machines/activate/preview` (27.1) doesn't run these checks: the refusal only comes on activate.

**Keep `fingerprint` stable** (hardware-based: board / CPU / disk serials). A fingerprint that changes after a reinstall would let a PC take a second trial and would break re-activation.

### 34.4 CSP plan blocked during the renewal (rev 26)

From the CSP plan's `subscriptionEndDate` until a mandate charge succeeds (≤ 3 attempts, 15 min apart, ~30 min), runtime calls answer **400 `SUBSCRIPTION_EXPIRED`** ("Subscription has expired.").

| Case | Desktop |
|---|---|
| 400 `SUBSCRIPTION_EXPIRED` | "Subscription inactive" (#6 / #25): `SubscriptionStatus = "INACTIVE"`, `Features = []`, stop automation and cash, **keep the heartbeat loop at the normal interval**, keep queuing receipts locally. Message: "Your plan is being renewed. Services resume as soon as the payment goes through." |
| next heartbeat 200 (charge succeeded) | restore from the response (`subscriptionStatus`, `features`, new `subscriptionEndDate`); upload the queued receipts. No re-activation |
| renewal failed 3 times / cancelled | stays `SUBSCRIPTION_EXPIRED` (or 400 `Subscription is not active.`) until the CSP buys a plan; then the PC carries over to the new plan by itself |

`graceEndsAt` is always `null` for CSP plans; don't add your own grace.

## 35. Cash receipts without notes: "Count needed" (rev 29, your ask 7) — READY

Built as you described. **The amount moves the balances at upload, the notes move the drawer only when the agent fills the count.** Works for `CASH_WITHDRAWAL`, `CASH_DEPOSIT` and `MONEY_TRANSFER`.

### 35.1 Upload: `POST /api/v1/receipts/upload-counts` (changed)

Request per receipt adds (both optional):
- **`denominationPending: true`** — the notes weren't counted (modal not saved). The server also works it out by itself: a successful cash receipt whose `cashDenomination` is **missing, `{}` or all zero** counts as "no notes".
- **`source`** — see #38.

A receipt becomes "Count needed" when **all** of these hold: its cash was **APPLIED** (a `NOT_APPLIED` receipt never needs one), it has no notes, and the PC's plan has `CASH_MANAGEMENT` (otherwise notes are never asked).

| Per accepted receipt | Meaning | Desktop |
|---|---|---|
| `cash: { status: "APPLIED" }` | applied with its notes (as today) | mark uploaded |
| `cash: { status: "APPLIED", denomination: "PENDING" }` | **new**: applied, notes still to count | mark uploaded and keep it in the Count needed list (or read the server list, 35.2) |
| `cash: { status: "NOT_APPLIED", reason }` | as today; no count request | — |

Cash in hand / cash in account move as for any cash receipt (withdrawal: hand − amount, account + amount; deposit / money transfer: the other way). The drawer doesn't move.

### 35.2 List: `GET /api/v1/machines/runtime/cash/receipt-counts?status=PENDING|DONE|ALL`

Credentials in headers like the other cash reads (or `POST` with them in the body). Default `PENDING`. For the **logged-in cash agent** (item 26), every day still kept by retention, **oldest first**, at most 200.

```json
"data": [ { "receiptId": "R-1", "agentId": "KO-002", "transactionCategory": "CASH_WITHDRAWAL",
            "transactionType": "Cash Withdrawal", "amount": 4500, "transactionAt": "…",
            "rrn": "6163467244324489", "status": "PENDING", "countedAt": null, "cashDenomination": null } ]
```
`DONE` rows have `countedAt` and the `cashDenomination` entered. Errors: the usual cash ones (403 `PLAN_NO_CASH_MANAGEMENT`, machine auth, section H).

### 35.3 Fill: `POST /api/v1/machines/runtime/cash/receipt-counts/:receiptId`

Body `{ machineCode, apiKey, fingerprint, cashDenomination: { all 12 keys } }` + header **`Idempotency-Key`** (a retry with the same key gets the first answer; same rules as the other cash writes).

| Check (in order) | Error |
|---|---|
| the receipt is this agent's | 404 **`RECEIPT_NOT_FOUND`** `Receipt not found.` |
| it still waits for its notes | 409 **`RECEIPT_COUNT_NOT_PENDING`** `This receipt's notes are already counted.` |
| notes' total = the receipt amount | 400 **`DENOMINATION_MISMATCH`** `The notes' total (₹4000.00) must equal the cash withdrawal amount (₹4500.00).` (`cash deposit` / `money transfer` for those) |
| withdrawal only: each count ≤ the drawer | 400 **`DRAWER_TOO_FEW_NOTES`** `Not enough ₹100 notes in the drawer.` |
| no open Adjust request (item 28) | 409 **`ADJUSTMENT_PENDING`** — kept as for every cash write (**confirmed by the owner 2026-11-08: the Adjust comes first**; the receipt stays pending meanwhile) |

Effect: withdrawal → the notes come **out** of the drawer; deposit / money transfer → they go **in** (no drawer check). Cash in hand doesn't change. The receipt keeps the denomination, `denominationPending: false`, `countedAt` set. Ledger **`RECEIPT_COUNT`** (`drawerChange` = the notes ±, `cashInHandChange` 0, `receiptId`, `remarks` `Notes for cash withdrawal ₹4500.00`).

→ **200** `Count saved.` `data: { receiptId, status: "DONE", cash: { cashInHand, drawer, drawerTotal } }` → save `data.cash` to `machineConfig.json` and refresh the screen.

### 35.4 Where it shows

- **Heartbeat** `cash.pendingCounts: { count, amount }` → controller strip badge "1 count needed", Overview banner.
- **`GET /machines/runtime/cash`** (and `?date=`): `today.transactions[]` `RECEIPT` entries carry **`denominationPending`** (true until filled) → the **Fill count** button on that row; the screen adds **`pendingCountAmount`** (next to `drawerMatchesCashInHand`) and `pendingCounts` → "₹6,500 still to count" instead of "doesn't match".
- **Close the day** answer adds `pendingCounts` (never blocks) → warn "2 withdrawals still need their notes" before / after the close.
- **CSP app:** "Count needed" on the receipt, and the pending total per agent on the Cash tab (no action for the CSP).

Tested (rollback test on the dev DB): withdrawal ₹4,500 without notes + ₹1,000 with notes + deposit ₹2,000 with `{}` → hand 10,000 → 6,500 at once, drawer only −2 × ₹500; list shows both pending (₹6,500); mismatch 400, too few notes 400, fill → drawer −9 × ₹500, second fill 409, deposit fill +4 × ₹500; drawer then matches cash in hand.

## 36. Close the day: cash in account too (rev 29, your ask 8) — READY

Exactly as asked. `POST /machines/runtime/cash/day-close` takes optional **`countedCashInAccount`** (₹ ≥ 0, 2 decimals; 400 `VALIDATION_FAILED` otherwise). Nothing moves.

- Answer `data`: `system.cashInAccount` and `counted.cashInAccount` (both `null` when not sent), **`accountDifference`** (counted − system; `null` when not sent), next to `difference` for cash in hand; plus `pendingCounts` (#35). Same fields in `GET /cash/day-close` and `dayClose` on the cash screen.
- `message`: `Day closed. The count matches. Cash in account is ₹200 less than the system.` / `Day closed. You're ₹500 short. Cash in account is ₹200 more than the system.` (no account sentence when it matches or wasn't sent).
- `GET /cash/days` items add `accountDifference`.
- Ledger `DAY_CLOSE` `remarks`: `Matched · account ₹200 less`.
- The CSP app shows both differences per close, each with its time. No correction request is made for cash in account (the CSP edits it in the app).

## 37. Shared PCs: the SBI kiosk user id (rev 29, your ask 9) — READY

We built **your option 2**. The CSP sets an agent's SBI kiosk User ID in the app **only when it differs from the agent ID** (`sbiUserId`, unique across agents, stored upper-case).

- **Heartbeat `accessAgents[]`** (and `GET /cash/session`) items add **`sbiUserId`** (`null` = the SBI id is the `agentId`):
  ```json
  { "agentId": "KO-002", "sbiUserId": "3A950035", "name": "Sita", "type": "KO", "emailMasked": "si***@gmail.com", "emailVerified": true }
  ```
- **`POST /machines/runtime/activity/start`** takes **`agentId` or `sbiUserId`** (one is required: 400 `Send agentId or sbiUserId.`). The server matches, ignoring case: `agentId` = an agent's id → `sbiUserId` = an agent's `sbiUserId` or id → an `agentId` that is someone's `sbiUserId`. So sending the typed id in either field works.
- Response 201 as today **plus `agentId`** (the agent the server matched — **use it for the receipts**) and `cashAgentId` (same).
- 403 **`AGENT_NOT_IN_FAMILY`** `This SBI user can't use this PC: only the CSP that owns it and its KOs can.` (another CSP's agent or nobody) → stop automation for that login, as today.
- Desktop: match the typed id against `sbiUserId` (else `agentId`) in `accessAgents`; when nothing matches send it as `sbiUserId` and use the `agentId` the server answers.

## 38. Where a receipt came from: `source` (rev 29, your ask 10) — READY

Exactly as asked.
- `POST /receipts/upload-counts`: each receipt may carry **`source`: `"AUTOMATION"` | `"MANUAL"`** (optional; leave out = unknown). Stored on the receipt.
- Any other value → that receipt is skipped with `INVALID_RECEIPT` `Invalid receipt (source): Invalid option: expected one of "AUTOMATION"|"MANUAL"` (the rest of the batch is accepted).
- `GET /machines/runtime/cash` (and `?date=`): `today.transactions[]` entries with a `receiptId` carry **`source`** (`null` when unknown or not a receipt).
- The CSP app shows "Automation" / "Manual" on receipts (`GET /receipts` items and detail have `source`).

## 39. Diagnostics: desktop log upload on request (rev 29, your ask 11) — READY

Built as asked. Nothing is sent without a request.

**39.1 Asking** — the super admin (console: `POST /admin/machines/:machineId/diagnostics`) or the CSP / BC (app: `POST /machines/:machineId/diagnostics`) asks for `fromDate`–`toDate` (IST `YYYY-MM-DD`, default today, only the **last 3 days** (today and the 2 days before; owner decision 2026-11-08); older → 400 `DIAGNOSTICS_RANGE_TOO_OLD`). **Send only the asked days, never more than the last 3 days of log files.** One open request per PC: a new one replaces the open one (that one becomes `CANCELLED`).

**39.2 Heartbeat and entitlements** add:
```json
"diagnostics": { "uploadRequested": true, "requestId": "DIAG-2026-000012", "fromDate": "2026-11-08", "toDate": "2026-11-08" }
```
`null` = nothing asked (also once the request is complete or cancelled).

**39.3 Upload** — `POST /api/v1/machines/runtime/diagnostics` (machine auth like the other runtime calls; headers or body; signed requests work):
```json
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…",
  "requestId": "DIAG-2026-000012", "appVersion": "1.0.0", "part": 1, "parts": 3,
  "fileName": "2026-11-08.log", "content": "<log text, UTF-8>" }
```
→ **201** `Diagnostics received.` `data: { requestId, part, received: true, complete }` (`complete: true` on the last missing part; the request becomes `RECEIVED` and the heartbeat stops asking).

| Rule | Error |
|---|---|
| an **open** request with this `requestId` for this PC | 404 **`DIAGNOSTICS_REQUEST_NOT_FOUND`** → stop (it was cancelled or replaced; a new `requestId` comes in the heartbeat) |
| `1 ≤ part ≤ parts ≤ 50`; the same `parts` on every part | 400 `VALIDATION_FAILED` / 400 `This request is being sent in 3 parts.` |
| `content` ≤ 2 MB (UTF-8); body ≤ 2.2 MB; `Content-Encoding: gzip` accepted | 413 **`PAYLOAD_TOO_LARGE`** → split smaller |
| rate limit (runtime limit per machine) | 429 → retry later |

A retry of the same `part` replaces it (safe after a timeout). Parts are kept **14 days**, then deleted. Answers to your rules: one call a minute and ≤ 1.5 MB parts are fine.

---

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
- **A receipt upload needs an ACTIVE machine session.** The machine heartbeat (step 2) *and* the activity heartbeat (step 4) both create/extend it. A session closes 120 s after the last of either (at most one missed heartbeat).
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
| 6 | activation unused — **or** already ACTIVE on this same PC (same fingerprint), which re-activates it (item #15) | 400 | `Activation has already been used.` / `Activation has already been used on another machine. Ask the owner to revoke it first.` |
| 7 | activation not expired | 400 | `Activation has expired.` |
| 8 | activation assigned to this agent | 400 | `Activation has not been assigned.` / `Activation is not assigned to this agent.` |
| 9 | agent belongs to the subscription owner | 400 | `Agent does not belong to this CSP subscription.` (or `BC`) |
| 10 | password | 400 | `Activation has not been assigned yet.` / `Invalid activation password.` |
| 11 | this PC has no other current active activation of the same owner type | 400 | `Machine already has an active CSP subscription.` (or `BC`) |
| 12 | **trial code only** (rev 27): this PC's fingerprint wasn't part of another account's trial | 409 `TRIAL_ALREADY_USED_ON_MACHINE` | `This PC has already been used for a free trial. Buy a plan to activate it.` |
| 13 | **trial code only** (rev 27): the activating agent ID wasn't part of another account's trial | 409 `TRIAL_ALREADY_USED` | `This SBI agent ID has already been used for a free trial. Buy a plan to activate it.` |

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

**Side effects:** creates or extends the machine session (new session if the last heartbeat was >120 s ago); updates machine info and `lastHeartbeatAt`.

**Response (200)**

```json
"data": {
  "serverTime": "2026-10-25T10:00:00.000Z",
  "heartbeatInterval": 60,
  "heartbeatTimeout": 120,
  "watcherEnabled": true,
  "receiptUploadEnabled": true,
  "subscriptionStatus": "ACTIVE",
  "latestWatcherVersion": "1.0.0",
  "planCode": "CSP_AUTOMATION",
  "subscriptionEndDate": "2026-11-24T18:42:13.000Z",
  "graceEndsAt": null,
  "features": ["DESKTOP_AUTOMATION", "RECEIPT_SYNC"],
  "minimumVersion": null,
  "downloadUrl": null,
  "ownerType": "CSP",
  "receiptWatcherAllowed": false,
  "receiptWatcherReason": "CSP_PLAN",
  "desktopControls": { "services": { "CASH_WITHDRAWAL": true, "...": true }, "receiptCashDenominationConfirm": true },
  "subscriptionType": "PAID",
  "isTrial": false
}
```

New fields: items #14 (`ownerType`, `receiptWatcher*`), #17 (`desktopControls`), #18 (versions), #33 (`subscriptionType` `"PAID"` / `"TRIAL"`, `isTrial`).

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

**Response (200):** `machine { machineCode, agentId }`, `activation { status, expiresAt }`, `subscription { id, subscriptionNumber, status, subscriptionType, startDate, endDate, graceEndsAt, plan { code, name, ownerType } }`, `features [ { code, name, description, category } ]`, plus `receiptWatcherAllowed`, `receiptWatcherReason` (#14), `desktopControls` (#17), `latestWatcherVersion`, `minimumVersion`, `downloadUrl`, `portalUrl` (#18).

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
  - 200, `restarted: true`: the old session timed out (e.g. internet outage > 120 s); the server opened a new one. **Replace the stored id** with the returned `activitySessionId`.
  - 409 `Activity session has ended. Start a new activity session.`: it was stopped or replaced (e.g. another start). If still logged in → call start (F1); else stop the timer.
  - 403 `No agent is currently assigned to this machine.`: machine was unassigned in the web app; stop the timer, show notice.
- **Offline:** skip ticks; don't queue or replay heartbeats.

### F3. `POST /machines/runtime/activity/stop`

- **When / reason:** explicit SBI logout → `LOGOUT`; detected SBI auto-logout / session expiry → `AUTO_LOGOUT`; app close / `FormClosing` / Windows shutdown → `APP_CLOSE`.
- **Body:** `+ activitySessionId`, `reason` (one of the three; anything else → 400).
- **Response (200):** `{ activitySessionId, stopped: true }`. Idempotent: unknown or already-closed ids also return 200.
- **Desktop:** cancel the timer first, then call stop once with a 3 s timeout. On app close don't wait longer and don't retry. If it fails, do nothing: the server closes the session 120 s after the last heartbeat.

## G. `POST /api/v1/receipts/upload-counts` — confirmed transactions

Full field table, enum values and the denomination keys are in items #1 and #2. This section adds the server logic and the desktop queue rules.

**When:** after the SBI transaction is **confirmed successful**. Failed/declined transactions are not uploaded (the server stores everything as `SUCCESS`). Always write the receipt to the local queue first, then upload from the queue (never directly from the workflow).

**Validation.** Request level (400 for the whole request): credentials present, `agentId`, `receipts` 1–20 items. Every rule below is checked **per receipt**: a failing receipt is returned in `skippedReceipts` with `Invalid receipt (<field>): <message>` and the rest of the batch is saved (item #16).

| Rule | Message (example) |
|---|---|
| `receipts`: 1–20 items (request level) | `At most 20 receipts per upload.` |
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

Per receipt, inside one DB transaction: duplicate id in the same request → skipped `Duplicate receipt in request.`; invalid receipt → skipped `Invalid receipt (...)`; `receiptId` already on the server for **this agent** (ids are unique per agent) → skipped `Receipt already exists.`; else saved with its denomination, and a float-ledger entry is written for cash/transfer categories. If anything throws, **nothing** from that request is saved, so the whole chunk can be retried safely.

**Desktop queue rules**

| Result | Queue action |
|---|---|
| in `acceptedReceipts` | `Uploaded` |
| in `skippedReceipts`, reason `Receipt already exists.` / `Duplicate receipt in request.` | `Uploaded` (it's on the server) |
| in `skippedReceipts`, reason starts with `Invalid receipt` | `Failed` + reason; no auto-retry |
| in `skippedReceipts`, reason `Receipt is older than the receipt retention period.` | `Failed` ("too old"); no auto-retry (item #20) |
| in `acceptedReceipts` with `cash.status = "NOT_APPLIED"` | `Uploaded` (saved and counted); show a notice: the balances couldn't cover it (item #21) |
| 429 | `Pending`; retry with backoff |
| 400 validation message | `Failed` + message; no auto-retry; show in an "upload problems" list |
| 400 `No active machine session found.` | `Pending`; retry after the next successful heartbeat |
| 400 `The assigned agent is not valid.` | `Pending`; show notice (agent deleted in the web app) |
| 400 credential messages (section H) | `Pending`; stop uploading until re-activated |
| 400 subscription messages / 403 | `Pending`; retry after a heartbeat shows the subscription/feature is back |
| network / timeout / 5xx | `Pending`; retry with backoff 30 s → 1 → 2 → 5 → 10 min (max), with jitter |

- Upload in chunks of ≤ 20, oldest first, one request at a time (no parallel uploads).
- Trigger: after enqueue, after each successful heartbeat, and on a 60 s timer when `Pending` rows exist.
- Before uploading old queued rows, map legacy denomination keys (#2) and drop rows older than 30 days to `Failed` ("too old") so a broken row can't loop forever.
- `totalCount` in the response = the agent's counts on the server for the last 12 months (item #20); use it for the on-screen counters (don't add locally).

## H. Error classification (all runtime endpoints)

Since rev 21 every error also has a stable **`code`** (e.g. `MACHINE_NOT_FOUND`, `API_KEY_INVALID`, `SUBSCRIPTION_EXPIRED`; the full list is in 22.9). Classify on `code`; the messages below stay as the fallback.

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

Other: **409** (activity only, F2). **429** (rate limit, item #18) and **5xx / network / timeout:** temporary; retry per endpoint rules, change no state.

`POST /receipts/upload` only: 403 `Receipt watcher is not allowed for this machine. Receipts are counted by CSP Manager.` → stop the watcher (item #14).

"Re-activation required" = set `MachineConfig.NeedsActivation = true`, stop the heartbeat/activity/upload loops (keep the local queue), and show the activation screen on next UI open. Receipts queued before re-activation upload afterwards (with the new `AgentId`).

## I. Plan → feature → desktop UI

| Plan (`planCode`) | Price | Features |
|---|---|---|
| `CSP_AUTOMATION` | ₹250 | `DESKTOP_AUTOMATION`, `RECEIPT_SYNC` (no cash management, #25.4) |
| ~~`CSP_AUTOMATION_CASH_MANAGEMENT`~~ | ~~₹450~~ | removed in rev 25 (#31) |
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

# Part 3 — Endpoint quick reference

Base URL: `https://<server>/api/v1` (dev: `http://192.168.1.4:3000/api/v1`). Most requests are `POST` with `Content-Type: application/json`; the cash reads are `GET` with the credentials in headers (item 22). No JWT. Every response is `{ "success", "message", "data" }`; errors are `{ "success": false, "code", "message" }`: decide on **`code`** (stable; list in 22.9), show `message`. 429 = rate limit (`RATE_LIMITED`): keep state, retry with backoff. Cash writes take an `Idempotency-Key` header (22.9 point 6).

Every runtime call (Q2–Q8) identifies the PC in one of three ways (item #19):

| Mode | How | When |
|---|---|---|
| **Signed (target)** | headers `X-Machine-Code`, `X-Machine-Fingerprint`, `X-Timestamp`, `X-Nonce`, `X-Signature`; no `apiKey` | PCs activated with a `devicePublicKey`. **Required in production.** |
| Header API key | headers `X-Machine-Code`, `X-Machine-Fingerprint`, `Authorization: Machine <apiKey>` | transition only |
| Body API key (today) | `machineCode`, `apiKey`, `fingerprint` in the JSON body | PCs without a device key, until production |

The examples below show the body form; in signed mode drop those three fields from the body and send the headers instead.

| # | Endpoint | Status | Called by | When |
|---|---|---|---|---|
| Q1 | `/machines/activate` | CHANGED (re-activation) | setup window | first install, after a format, after "re-activation required" |
| Q2 | `/machines/runtime/heartbeat` | CHANGED (new fields) | background service | on start, then every `heartbeatInterval` s |
| Q3 | `/machines/runtime/entitlements` | CHANGED (new fields) | CSP Manager UI | before every service start; plan details screen |
| Q4 | `/machines/runtime/activity/start` | unchanged | CSP Manager UI | SBI login begins |
| Q5 | `/machines/runtime/activity/heartbeat` | unchanged | CSP Manager UI | every `heartbeatInterval` s while logged in |
| Q6 | `/machines/runtime/activity/stop` | unchanged | CSP Manager UI | logout, auto-logout, app close |
| Q7 | `/receipts/upload-counts` | CHANGED (new values, per-receipt validation) | CSP Manager UI | queued confirmed receipts, ≤ 20 per request |
| Q8 | `/receipts/upload` | CHANGED (watcher gate, ≤ 20) | background watcher | only when `receiptWatcherAllowed = true` |
| Q9 | `GET /machines/runtime/cash` | **NEW** | CSP Manager UI (cash screen) | opening the cash screen; after every settlement action |
| Q10 | `/machines/runtime/cash/settlements` | **NEW** | CSP Manager UI (Settlement button) | starting a settlement |
| Q11 | `/machines/runtime/cash/settlements/:settlementId` | **NEW** | CSP Manager UI (open settlement card) | Approve / Cancel |
| Q12 | `/machines/runtime/cash/requests` | **NEW** | CSP Manager UI | asking the CSP to correct cash in hand / drawer |
| Q13 | `/machines/runtime/cash/labels`, `/cash/custom-transactions` | **NEW** | Cash Management "New transaction" | §22.1 |
| Q14 | `/machines/runtime/cash/dues`, `/cash/dues/:id` | **NEW** | Balance due tab / card | §22.2 |
| Q15 | `/machines/runtime/cash/exchanges` | **NEW** | Settlement tab "Cash exchange" | §22.3 |
| Q16 | `/machines/runtime/cash/day-close`, `/cash/days`, `/cash?date=` | **NEW** | Close the day, History tab | §22.4–22.5 |
| Q17 | `/machines/runtime/cash/tasks`, `/cash/tasks/:id` | **NEW** | Tasks tab | §22.6 |
| — | `/events`, `/api/events`, `/api/auth/activate`, `/api/config/sync`, `/receipt` | **REMOVED** (404) | — | delete the calling code |

Q9 is a `GET` (credentials in headers; `POST` with the body form also works). Q9–Q12 are described in full in §21.6, §21.7 and §21.4; Q13–Q17 in item 22 (the table in §22.7 lists every method and path).

Rate limits: Q2–Q17 share **120 requests/min per machine**; Q1 is **20 per 15 min per IP**.

### Q1. `POST /api/v1/machines/activate`

```json
{
  "agentId": "CSP-001",
  "activationCode": "K7M2-QX9P-RT4W-HB3N",
  "activationPassword": "<typed by the user>",
  "cashInHand": 6000,
  "cashDenomination": { "notes500": 10, "notes100": 10 },
  "machine": {
    "fingerprint": "4C4C4544-0042-3510-8051-B4C04F383732",
    "watcherVersion": "1.0.0",
    "machineName": "Front desk PC",
    "osName": "Windows", "osVersion": "10.0.19045",
    "deviceName": "DESKTOP-01", "ipAddress": "192.168.1.20",
    "devicePublicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…(base64 SPKI)"
  }
}
```

`devicePublicKey` (item #19.2): send it to switch this PC to signed requests.

`cashInHand` + `cashDenomination` (item #21.5): the agent's counted cash, **required when the agent is a KO**.

Response 201:

```json
{ "success": true, "message": "Machine registered and activated successfully.",
  "data": { "machineCode": "MAC-2026-000001", "apiKey": "<64 hex chars>",
            "cash": { "status": "APPLIED", "cashLimit": 100000, "cashInAccount": 89000, "cashInHand": 6000 } } }
```

How to use:
- `agentId`, `activationCode` (uppercase, with dashes), `activationPassword` and `fingerprint` are required; the rest optional. Never store or log the password.
- **Re-activation after a format:** same code + same password + same PC → 201 `Machine re-activated successfully. The previous API key no longer works.` with the **same** `machineCode` and a **new** `apiKey`. Nothing special on the desktop side: it's the normal activation screen.
- On 201 write a fresh `MachineConfig` atomically (MachineCode, ApiKey (DPAPI), Fingerprint, AgentId = the one you sent), tell the service to reload, then call Q2 at once.
- Every error is shown to the user as-is (section C lists them). Notable: `Activation has already been used on another machine. Ask the owner to revoke it first.` (different hardware; the owner requests a revoke in the mobile app, the super admin approves).

### Q2. `POST /api/v1/machines/runtime/heartbeat`

```json
{ "machineCode": "MAC-2026-000001", "apiKey": "<64 hex>", "fingerprint": "<SMBIOS UUID>",
  "watcherVersion": "1.0.0", "osName": "Windows", "osVersion": "10.0.19045",
  "deviceName": "DESKTOP-01", "ipAddress": "192.168.1.20",
  "lastStartupAt": "2026-10-30T03:00:00.000Z", "lastTransactionAt": "2026-10-30T05:10:00.000Z" }
```

(`machineCode`, `apiKey`, `fingerprint`, `watcherVersion` required; the rest optional.)

Response 200:

```json
"data": {
  "serverTime": "2026-10-30T05:12:00.000Z", "heartbeatInterval": 60, "heartbeatTimeout": 120,
  "watcherEnabled": true, "receiptUploadEnabled": true,
  "subscriptionStatus": "ACTIVE", "planCode": "BC_BASIC", "ownerType": "BC",
  "subscriptionEndDate": "2026-11-29T18:30:00.000Z", "graceEndsAt": null,
  "features": ["DESKTOP_AUTOMATION", "RECEIPT_SYNC", "CASH_MANAGEMENT", "MOBILE_TRACKING"],
  "receiptWatcherAllowed": true, "receiptWatcherReason": "BC_PLAN",
  "desktopControls": {
    "services": { "BALANCE_ENQUIRY": true, "MINI_STATEMENT": true, "CASH_WITHDRAWAL": true,
      "CASH_DEPOSIT": true, "MONEY_TRANSFER": true, "PASSBOOK_PRINTING": true,
      "FUND_TRANSFER": true, "TRANSACTION_HISTORY": true, "KYC_UPDATION": true,
      "ACCOUNT_OPENING": true, "AADHAAR_SEEDING": true, "AEPS_REGISTRATION": true },
    "receiptCashDenominationConfirm": true
  },
  "latestWatcherVersion": "1.0.0", "minimumVersion": null, "downloadUrl": null,
  "subscriptionType": "PAID", "isTrial": false,
  "accessAgents": [ { "agentId": "KO-002", "sbiUserId": null, "name": "Sita", "type": "KO", "emailMasked": "si***@gmail.com", "emailVerified": true } ],
  "cash": { "…": "as before", "pendingCounts": { "count": 0, "amount": 0 } },
  "diagnostics": null
}
```

How to use:
- Save every field to `MachineConfig` (offline = last saved values). Next call after `heartbeatInterval` s (clamp 30–300).
- `receiptWatcherAllowed` → run or stop the watcher (item #14). `ownerType` replaces the plan-list lookup.
- `desktopControls` → `ServiceSwitches`, `ReceiptCashDenominationConfirm` (item #17).
- `minimumVersion` > current → block automation, offer `downloadUrl`; `latestWatcherVersion` > current → "update available" (item #18).
- The heartbeat also keeps the machine session alive, which Q7/Q8 need.
- `isTrial` → trial banner "Free trial — ends <subscriptionEndDate>" (item #33/#34).
- `cash.pendingCounts` → "Count needed" badge (#35); `accessAgents[].sbiUserId` → SBI login matching (#37); `diagnostics` → log upload (#39).

### Q3. `POST /api/v1/machines/runtime/entitlements`

```json
{ "machineCode": "MAC-2026-000001", "apiKey": "<64 hex>", "fingerprint": "<SMBIOS UUID>" }
```

Response 200:

```json
"data": {
  "machine": { "machineCode": "MAC-2026-000001", "agentId": "CSP-001" },
  "activation": { "status": "ACTIVE", "expiresAt": "2026-11-29T18:30:00.000Z" },
  "subscription": { "id": "…", "subscriptionNumber": "SUB-2026-000001", "status": "ACTIVE",
    "subscriptionType": "PAID", "startDate": "…", "endDate": "…", "graceEndsAt": null,
    "plan": { "code": "CSP_AUTOMATION", "name": "CSP Automation", "ownerType": "CSP" } },
  "features": [ { "code": "DESKTOP_AUTOMATION", "name": "…", "description": "…", "category": "…" } ],
  "receiptWatcherAllowed": false, "receiptWatcherReason": "CSP_PLAN",
  "desktopControls": { "services": { "CASH_WITHDRAWAL": false, "…": true }, "receiptCashDenominationConfirm": true },
  "latestWatcherVersion": "1.0.0", "minimumVersion": null, "downloadUrl": null,
  "portalUrl": null
}
```

How to use:
- Call **before every service start**. If `desktopControls.services[<CODE>] === false`, don't start it and show `<Service> is turned off by the admin. Contact support to turn it on.`
- `portalUrl` `null` → hide/disable "Renew / subscribe"; otherwise open it in the browser.
- Same caching and error handling as Q2.

### Q4. `POST /api/v1/machines/runtime/activity/start`

```json
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…", "agentId": "CSP-001" }
```

Response 201: `{ activitySessionId, startedAt, restarted: false, heartbeatInterval, heartbeatTimeout }`. How to use: section F1. Keep `activitySessionId` for Q5/Q6. Never block SBI login on it.

### Q5. `POST /api/v1/machines/runtime/activity/heartbeat`

```json
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…", "activitySessionId": "ACT-2026-000001" }
```

Response 200: `{ activitySessionId, restarted }`. If `restarted: true`, store the new id. 409 → call Q4 again if still logged in. Section F2.

### Q6. `POST /api/v1/machines/runtime/activity/stop`

```json
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…", "activitySessionId": "ACT-2026-000001", "reason": "LOGOUT" }
```

`reason`: `LOGOUT` | `AUTO_LOGOUT` | `APP_CLOSE`. Response 200 `{ activitySessionId, stopped: true }`, idempotent. 3 s timeout, no retry. Section F3.

### Q7. `POST /api/v1/receipts/upload-counts`

```json
{
  "machineCode": "…", "apiKey": "…", "fingerprint": "…",
  "agentId": "CSP-001",
  "receipts": [
    { "receiptId": "61631801122527224246673224", "receiptType": "AEPS",
      "transactionCategory": "CASH_WITHDRAWAL", "transactionType": "Cash Withdrawal",
      "transactionAt": "2026-10-30T05:10:00.000Z", "count": 1, "amount": 1000,
      "rrn": "6163467244324489", "location": "RASULPUR",
      "cashDenomination": { "notes500": 1, "notes100": 5 } },
    { "receiptId": "PASSBOOK-20261030104000123-A1B2C3", "receiptType": "PASSBOOK",
      "transactionCategory": "PASSBOOK_PRINTING", "transactionType": "Passbook Printing",
      "transactionAt": "2026-10-30T05:10:00.123Z", "count": 1 },
    { "receiptId": "HAN990104630102026", "receiptType": "PMSBY",
      "transactionCategory": "SOCIAL_SECURITY", "transactionType": "PMSBY",
      "transactionAt": "2026-10-30T05:11:00.000Z", "count": 1 }
  ]
}
```

Response 201:

```json
"data": {
  "acceptedCount": 2, "acceptedRecords": 2, "skipped": 1,
  "acceptedReceipts": [ { "receiptId": "PASSBOOK-…", "count": 1 }, { "receiptId": "HAN990104630102026", "count": 1 } ],
  "skippedReceipts": [ { "receiptId": "61631801122527224246673224", "reason": "Receipt already exists." } ],
  "totalCount": { "receiptType": { "…": 0 }, "transactionCategory": { "…": 0 }, "transactionType": { "…": 0 } }
}
```

How to use:
- 1–20 receipts, oldest first, one request at a time. `agentId` = `MachineConfig.AgentId`. Leave out null fields; `count` is always 1.
- `amount` only for `CASH_DEPOSIT`, `CASH_WITHDRAWAL`, `MONEY_TRANSFER` (required there); never for passbook or social security.
- Per receipt: in `acceptedReceipts` → Uploaded; skipped with `Receipt already exists.` / `Duplicate receipt in request.` → Uploaded; skipped with a reason starting `Invalid receipt` or `Receipt is older than the receipt retention period.` → Failed (keep reason, no retry); in neither list → keep queued and retry.
- Needs an active machine session (Q2 or Q5 in the last 120 s): 400 `No active machine session found.` → retry after the next heartbeat. Full rules: section G, item #16.

### Q8. `POST /api/v1/receipts/upload` (background watcher only)

```json
{
  "machineCode": "…", "apiKey": "…", "fingerprint": "…",
  "receipts": [
    { "receiptId": "R-1", "receiptType": "AEPS", "transactionCategory": "CASH_DEPOSIT",
      "transactionType": "Cash Deposit", "status": "SUCCESS",
      "transactionAt": "2026-10-30T05:10:00.000Z", "amount": 500,
      "rrn": "…", "stan": "…", "terminalId": "…", "location": "…" }
  ]
}
```

Response 201: `data { total, uploaded, skipped, uploadedReceipts, skippedReceipts }`.

How to use:
- Only when the last `receiptWatcherAllowed` was `true`. Otherwise the server answers 403 `Receipt watcher is not allowed for this machine. Receipts are counted by CSP Manager.` → stop the watcher.
- 1–20 receipts; `status`, `transactionAt` and `amount` required on each; one invalid receipt fails the whole request (400) here, unlike Q7. No `agentId` (the machine's assigned agent is used).
- Don't send `customerName` / `customerAccount` unless the product asks for them (pre-production checklist 5C.6).
- Skipped reasons: `Duplicate receipt in request.`, `Receipt already exists.` (both = on the server) and `Receipt is older than the receipt retention period.` (= drop it, item #20).

### Q9. `GET /api/v1/machines/runtime/cash`

Headers `X-Machine-Code`, `X-Machine-Fingerprint`, `Authorization: Machine <apiKey>` (or signed). Response 200: today's cash screen for this PC's agent (§21.6): `cashLimit`, `cashInAccount`, `cashInTransit`, `cashLeftInBank`, `cashInHand`, `drawer`, `today { totals, transactions, settlements }`, `openSettlements`, `lastRequest`.

### Q10. `POST /api/v1/machines/runtime/cash/settlements`

```json
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…", "direction": "ACCOUNT_TO_HAND" | "HAND_TO_ACCOUNT" | "BANK_TO_HAND", "amount": 2000, "cashDenomination": { … } (HAND_TO_ACCOUNT only), "remarks": "…" }
```

Response 201: the open step `{ id, direction, step, label, status: "PENDING", amount, needsDenomination, … }`. 400 not enough cash in account / hand / left in bank, denomination errors; 409 one already open (§21.7).

### Q11. `POST /api/v1/machines/runtime/cash/settlements/:settlementId`

```json
{ "machineCode": "…", "apiKey": "…", "fingerprint": "…", "action": "APPROVE" | "CANCEL", "cashDenomination": { … }, "amount": 2000, "remarks": "…" }
```

Response 200: `{ approved, next }` (next = step 2 or null) or `{ cancelled, next: null }`. `cashDenomination` for bank → cash in hand steps, `amount` for bank → cash in account (§21.7).

### Q12. `POST /api/v1/machines/runtime/cash/requests`

`{ …credentials, "cashInHand", "drawer"?, "reason" }` → 201 PENDING; the CSP approves in the app (§21.4).

---

## Changelog

- 2026-11-08 (rev 29, update) — #39: logs only for the last 3 days (`DIAGNOSTICS_RANGE_TOO_OLD`); #35: the Adjust-first rule confirmed by the owner.
- 2026-11-08 (rev 29) — Your asks 7–11 built: #35 cash receipts without notes (`denominationPending`, `cash.denomination: "PENDING"` on upload, `GET` / `POST /machines/runtime/cash/receipt-counts`, ledger `RECEIPT_COUNT`, heartbeat `cash.pendingCounts`, cash screen `pendingCountAmount` and `today.transactions[].denominationPending`); #36 day close `countedCashInAccount` / `accountDifference`; #37 `sbiUserId` in `accessAgents` and on `activity/start` (response adds `agentId`); #38 receipt `source`; #39 diagnostics (heartbeat / entitlements `diagnostics`, `POST /machines/runtime/diagnostics`, 2 MB parts, 14 days).
- 2026-11-08 (rev 28) — Item #34: one checklist of every API change in rev 26–27 (heartbeat `subscriptionType` / `isTrial`, trial activation refusals, CSP renewal blocking) with success / failure handling. Section C table rows 12–13, sections D and Q2 response updated.
- 2026-11-07 (rev 27) — Item #33 free trial: heartbeat `subscriptionType` / `isTrial`; trial activation refused with 409 `TRIAL_ALREADY_USED_ON_MACHINE` / `TRIAL_ALREADY_USED`.
- 2026-11-07 (rev 26) — Owner decisions: a CSP plan is blocked from its end date until the mandate renewal succeeds (25.2: `SUBSCRIPTION_EXPIRED` during the retries; it unblocks by itself); the grace period (#24) applies to BC plans only.
- 2026-11-07 (rev 25) — Items #25–#32: plan blocking screens (automation + cash management replaced with "Please ask your CSP to renew…" + View plans; ₹250 has no cash management); shared PCs (any agent of the CSP family, `accessAgent` / `accessAgents` / `cashAgentId` in the heartbeat, cash follows `activity/start` agent, email OTP cash login / logout / session, KO email verification); activation preview + `differenceSource` + email OTP, cash not required without cash management, one activation per agent; mandatory Adjust requests (`/cash/adjustments`, 409 `ADJUSTMENT_PENDING`) and one-step `/cash/transfer`; failed receipts skipped (`status`, `FAILED_TRANSACTION`), `agentId` = SBI-logged-in agent; automation fixes 30.1–30.8 (30.8 Peri / Morpho restart pending details); ₹450 plan removed; KO replace / delete.

- 2026-11-04 (rev 24) — Item #24: slip image upload (`POST /receipts/slip/upload-url` → S3 → `POST /receipts/slip`) when `slip` is in `receiptFields.allowed`; `rrn` / `location` fixed defaults (`stan`, `terminalId` now optional, off by default); grace period keeps the PC working until `graceEndsAt`.

- 2026-11-04 (rev 23, update) — §23.1: what to build for receipt fields (save the list in machineConfig, send only those, per-field types and defaults, example), receipts may carry different fields.
- 2026-11-04 (rev 23) — Item #23: `receiptFields.allowed` in heartbeat + entitlements (send only those optional fields; no Aadhaar); `upload-counts` accepts the optional fields; heartbeat timeout 120 s (one missed heartbeat) for machine and activity sessions; commission is server-side.

- 2026-11-04 (rev 22) — §22.2: `GET /machines/runtime/cash/dues/:id` (one due with its history).

- 2026-11-03 (rev 21) — Answers to the desktop's 6.8 (22.9): due `cashSide` (cash in hand / cash in account move against each other; extra cash with the new `cashDueExtra`), `cash` with every balance on due answers, notes required for applied receipt dues; `code` on every error and on skipped receipts; `Idempotency-Key` on cash writes; settlement `requestId` / `stepNumber` / `stepCount` / `previousStep`; heartbeat `cash.openSettlement`, `cash.tasks`, `dues.bySide`; `dues` on the cash screen; exchange remarks; default labels; faster cash reads.
- 2026-11-03 (rev 20, update) — Item #22: coverage table (22.0), screen-by-screen to-do (22.8), `POST` forms of `/cash/labels` and `/cash/days`, whole-rupee amounts in the day-close message, how to keep the saved cash current; item #21 intro updated.
- 2026-11-03 (rev 20) — Item #22: cash management extras from the desktop's requirements doc item 6 (labels and custom transactions, balance due, cash exchange, close the day, history with `?date=` and `/cash/days`, tasks); "other cash" (`cashOther`); dues in the heartbeat `cash`; desktop cash calls refused (403) without `CASH_MANAGEMENT`; activation count saved before setup (`SAVED`). Part 3: Q13–Q17.

- 2026-11-02 (rev 19) — §21.7: step-by-step screen flow for the cash screen and Settlement button (all three directions, approve/cancel by step, refresh + config save). Part 3: Q9–Q12 cash endpoints.

- 2026-11-02 (rev 18) — Item #21.7: settlement direction `BANK_TO_HAND` (left in bank → cash in hand; one step, created from `cashLeftInBank`, approved with the counted notes); ledger type `SETTLEMENT_HELD`.

- 2026-11-02 (rev 17) — Item #21.6–21.7: step 2 can deliver less in both directions (bank → cash in account takes `amount`); the rest is **left in bank** (`cashLeftInBank` in the today screen and heartbeat `cash`, `leftInBank` per step), shown separately. One open settlement per KO (409).

- 2026-11-02 (rev 16) — Item #21.6–21.7: `GET /machines/runtime/cash` (today's cash screen for this PC's agent) and KO self-approved two-step settlements (`POST /machines/runtime/cash/settlements`, `POST /machines/runtime/cash/settlements/:id` approve/cancel); `cashInTransit` in the heartbeat `cash`.

- 2026-11-02 (rev 15) — Item #21.5: `POST /machines/activate` takes `cashInHand` + `cashDenomination` (required for a KO; total must match); they set the agent's cash in hand and drawer, and cash in account adapts; response `data.cash`.
- 2026-11-02 (rev 14) — Item #21: cash management. Heartbeat `cash` (cash limit, cash in account, own cash in hand and drawer, last request) to cache in `machineConfig.json` and check before each cash transaction; per-receipt `cash` result on uploads; `POST /machines/runtime/cash/requests` for CSP-approved changes.
- 2026-11-01 (rev 13) — Item #20: the retention period is set by the super admin (15–365 days, default 60); the skip reason and queue handling are unchanged.
- 2026-10-31 (rev 12) — Item #20: receipts are kept 60 days; both upload endpoints skip receipts older than that (`Receipt is older than the receipt retention period.` → Failed, no retry); `totalCount` covers the last 12 months. Section G, Q7 and Q8 updated.
- 2026-10-30 (rev 11) — Item #19 READY: device key (ECDSA P-256, `machine.devicePublicKey` at activation), signed requests (`X-Machine-Code`, `X-Machine-Fingerprint`, `X-Timestamp`, `X-Nonce`, `X-Signature`), header credentials (`Authorization: Machine <apiKey>`). Backward compatible until the server sets `MACHINE_SIGNATURE_REQUIRED=true` (production).
- 2026-10-30 (rev 10) — Added Part 3: endpoint quick reference (Q1–Q8) with URL, request, response and how to use. Revoke is now requested by the owner in the mobile app and approved by the super admin (item #15). Added item #19 (machine credential security plan: HTTPS + DPAPI now, signed requests later).
- 2026-10-30 (rev 9) — Answers the desktop requirements doc (audit 2026-10-29). Items #14–#18: `receiptWatcherAllowed` / `receiptWatcherReason` / `ownerType`; same-PC re-activation and web-app revoke; `PASSBOOK` / `PASSBOOK_PRINTING`, per-agent `receiptId`, per-receipt validation, report columns; `desktopControls`; `minimumVersion`, `downloadUrl`, `portalUrl` (null for now); removed `/events`, `/api/auth/activate`, `/api/config/sync`, `/receipt`; rate limits (429). Sections C, D, E, G, H updated.

- 2026-10-25 (rev 8) — §C: activation code format is `XXXX-XXXX-XXXX-XXXX` (was described as 16 plain characters). A CSP plan can now cover several machines; each machine still activates with its own code, so nothing changes on the desktop.
- 2026-10-25 (rev 7) — Section I: BC plans now list explicit features; added the ₹799 `BC_CSP_LINK` plan (no machines) and the `CSP_LINKING` feature.
- 2026-10-25 (rev 6) — Backend fixes: `upload-counts` accepts machines assigned to a **KO** (message now `The assigned agent is not valid.`); BC plans report all features in heartbeat/entitlements and pass the upload feature check; legacy `/receipts/upload` returns 400/403 instead of 500 for "no active session" / "no agent". Section J trimmed accordingly.
- 2026-10-25 (rev 5) — Added Part 2: full desktop API reference (A–J). Corrected #6 (expired subscription is 400 from machine auth, not 403) and #8 (re-activation refused while an active activation of the same owner type exists).
- 2026-10-25 — Initial version: items 1–12.
- 2026-10-25 (rev 4) — #12 now READY: activity start/heartbeat/stop contract; #11 updated (UI activity heartbeat keeps the machine session alive).
- 2026-10-25 (rev 3b) — #1: `upload-counts` accepts at most 20 receipts per request.
- 2026-10-25 (rev 3) — Added #13: renewal/upgrade keep the machine activated; no re-activation prompt.
- 2026-10-25 (rev 2) — #2 now READY: backend added `notes200`; desktop must rename all keys to the backend names and add ₹5 note, ₹20/₹2/₹1 coin inputs.
