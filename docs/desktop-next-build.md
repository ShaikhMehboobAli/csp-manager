# Desktop (Windows) — what to build next (handoff, 2026-11-12)

**For:** the C# / .NET team (WinForms app + ReceiptWatcher service). **Backend:** ready on the dev server for everything below (desktop doc rev 29–31).
**Full contracts:** `docs/desktop-integration-changes.md` (item numbers in brackets). This page is the build list; the doc has every field.

Errors are `{ success: false, code, message, details? }`. Show `message`; branch on `code`; `details` (new) carries extras such as `retryAfterSeconds`. Cash writes take an `Idempotency-Key` header (#26–#28 rules).

## What the desktop does NOT build

- **No push notifications.** Firebase can't deliver to a Windows app/service. Everything reaches the PC through the **service heartbeat** (every 60 s): plan, cash, settings, diagnostics, day-close reminder. Show Windows toasts yourself from heartbeat changes.
- **No payments / Razorpay.** Only the CSP pays, in the mobile app. When the plan is blocked the desktop shows "Ask your CSP to renew" and the plan list (#30–#34), as before.
- **Never ship Firebase or Razorpay keys** in the installer.

---

## Build order

| # | Feature | Doc |
|---|---|---|
| 1 | Day-close reminder (toast + banner) | #40 |
| 2 | "Count needed" cash receipts | #35 |
| 3 | Close the day with cash in account | #36 |
| 4 | SBI kiosk user id matching (shared PCs) | #37 |
| 5 | Receipt `source` | #38 |
| 6 | Send logs on request (last 3 days only) | #39 |
| 7 | Email OTP: resend countdown + new errors | rev 30–31 notes, 26.x |
| 8 | Keep the heartbeat running (offline alerts) | #40 |

If not built yet from earlier releases: block screens and plan list (#30–#34), shared-PC cash login (#26), activation email pre-fill / verify (#27), Adjust requests (#28), trial banner and refusals (#33–#34).

---

## 1. Day-close reminder (#40)

Heartbeat adds `dayCloseReminder` (null = nothing to show):
```json
"dayCloseReminder": { "closeTime": "18:00", "remindAt": "2026-11-11T12:30:00.000Z", "overdue": false,
                      "message": "Please close the day by 18:00: count your cash and close it in Cash." }
```
- Starts **30 min before the CSP's closing time** (team settings), or **at 18:00 IST** when none is set; turns `null` once the **cash agent** (`cashAgentId`) closes the day (`POST /machines/runtime/cash/day-close`).
- Show a **Windows toast** once per agent per day (remember locally) and a **banner** on the Cash screen with a "Close day" button while non-null. You may toast again when `overdue` flips to `true` ("It's past 18:00…").
- It follows the cash login: another agent logs in → the field is about that agent.

## 2. "Count needed" cash receipts (#35)

- **Upload** (`POST /receipts/upload-counts`): a successful cash receipt (withdrawal / deposit / money transfer) without notes (`cashDenomination` missing, `{}` or all zero, or `denominationPending: true`) is accepted with `cash: { status: "APPLIED", denomination: "PENDING" }`. Cash in hand and account move now; the **drawer moves only when the notes are filled**.
- **List:** `GET /machines/runtime/cash/receipt-counts?status=PENDING|DONE|ALL` (default PENDING, oldest first, max 200) → `[{ receiptId, agentId, transactionCategory, amount, transactionAt, rrn, status, countedAt, cashDenomination }]`.
- **Fill:** `POST /machines/runtime/cash/receipt-counts/:receiptId` `{ machineCode, apiKey, fingerprint, cashDenomination }` + `Idempotency-Key` → 200 `Count saved.` `data: { receiptId, status: "DONE", cash: { cashInHand, drawer, drawerTotal } }` → save `data.cash`.

| Error | Show |
|---|---|
| 404 `RECEIPT_NOT_FOUND` | refresh the list |
| 409 `RECEIPT_COUNT_NOT_PENDING` | "Already counted"; refresh |
| 400 `DENOMINATION_MISMATCH` | "Notes total must equal ₹…" (keep the form) |
| 400 `DRAWER_TOO_FEW_NOTES` (withdrawal) | "Not enough ₹100 notes in the drawer" |
| 409 `ADJUSTMENT_PENDING` | finish the CSP's Adjust request first (owner rule: Adjust comes first) |

- **Where it shows:** heartbeat `cash.pendingCounts: { count, amount }` (badge "1 count needed"); cash screen `today.transactions[].denominationPending` (Fill count button), `pendingCountAmount`; day close answer `pendingCounts` (warn, never blocks).

## 3. Close the day with cash in account (#36)

`POST /machines/runtime/cash/day-close` takes optional **`countedCashInAccount`** (₹, 2 decimals). Answer adds `system.cashInAccount`, `counted.cashInAccount`, **`accountDifference`** (counted − system; null when not sent) and `pendingCounts`. Show `message` as is ("Day closed. You're ₹500 short. Cash in account is ₹200 more than the system."). Nothing moves; the CSP fixes cash in account in the app.

## 4. SBI kiosk user id (#37)

- Heartbeat `accessAgents[]` items carry **`sbiUserId`** (null = the SBI id is the `agentId`).
- Match the id typed at the SBI kiosk against `sbiUserId`, else `agentId`.
- `POST /machines/runtime/activity/start` takes **`agentId` or `sbiUserId`** (400 `Send agentId or sbiUserId.`). The 201 answer adds **`agentId`** (the agent the server matched: use it for receipts) and `cashAgentId`.
- 403 `AGENT_NOT_IN_FAMILY` → stop automation for that login.

## 5. Receipt `source` (#38)

Each receipt in `upload-counts` may carry `source: "AUTOMATION" | "MANUAL"` (leave out = unknown). Any other value → that receipt is refused with `INVALID_RECEIPT`; the rest of the batch is accepted. The cash screen shows `source` on receipt rows.

## 6. Send logs on request (#39)

- Heartbeat / entitlements `diagnostics`: `{ uploadRequested: true, requestId, fromDate, toDate }` or null.
- **Only the asked days, never more than the last 3 days** (today + 2 before; owner rule).
- Upload: `POST /machines/runtime/diagnostics` `{ machineCode, apiKey, fingerprint, requestId, appVersion, part, parts, fileName, content }` → 201 `data: { requestId, part, received, complete }`. Parts ≤ 2 MB (gzip allowed), at most 50; a retry of the same part replaces it.
- 404 `DIAGNOSTICS_REQUEST_NOT_FOUND` → stop (cancelled / replaced); 413 `PAYLOAD_TOO_LARGE` → split smaller; 429 → retry later.

## 7. Email OTP: countdown and new errors (rev 30–31)

Both email OTP calls are now really emailed (from **CSP Manager \<no-reply@cspmanager.in\>**):
- `POST /machines/activate/email/otp` (activation form) and `POST /machines/runtime/cash/email/otp` / `cash/login/otp` (cash panel) → `data: { sentTo, expiresInSeconds: 600, resendAvailableAt, resendInSeconds: 60 }`.

| Answer | Desktop |
|---|---|
| 200 | disable "Send again" and count down from `resendInSeconds` |
| 400 `OTP_RESEND_TOO_SOON` / `OTP_RESEND_LIMIT` + `details: { retryAfterSeconds, resendAvailableAt }` | restart the countdown from `retryAfterSeconds` (limit: up to an hour) |
| 429 `EMAIL_RATE_LIMITED` + `details.retryAfterSeconds` | same countdown (10 emails per address per hour) |
| 503 `EMAIL_SEND_FAILED` | "We couldn't send the email right now; try again in a minute" |

The agent also gets a **welcome email** with its Agent ID, activation code and password when the CSP assigns the code. Nothing to call on the desktop; the activation screen can say "Check your email for the code and password".

## 8. Keep the heartbeat running (#40)

The owner's app gets "PC offline" when a PC sends **no service heartbeat for 1 hour within the working day** (CSP's start–closing time, else 09:00–19:00 IST), once per outage. Keep the **service** heartbeat running whenever the PC is on, even with no one logged in. Switching the PC off at night is fine (nothing is sent outside working hours).

## Test checklist (dev server)

- [ ] After the reminder time, heartbeat shows `dayCloseReminder` → toast once + banner; close the day → it turns null within 60 s.
- [ ] Upload a withdrawal without notes → `denomination: "PENDING"`, badge shows; fill it → drawer moves, badge clears.
- [ ] Day close with `countedCashInAccount` → `accountDifference` in the answer.
- [ ] Kiosk login with an SBI id that differs from the agent id → `activity/start` answers the right `agentId`.
- [ ] Ask for logs from the app → upload parts → request becomes RECEIVED, heartbeat stops asking.
- [ ] Ask for an email OTP twice quickly → countdown restarts from `retryAfterSeconds`.
- [ ] Stop the service for over an hour during working hours → the CSP app gets "PC offline".
