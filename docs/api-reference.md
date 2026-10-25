# API reference — endpoints added or changed

**Audience:** backend owner (Postman collection), mobile and admin web teams.
**Last updated:** 2026-10-25

Base URL: `{{baseUrl}}` = `http://localhost:3000/api/v1` (dev). Auth: `Bearer {{accessToken}}` for JWT routes; desktop routes authenticate with `machineCode` / `apiKey` / `fingerprint` in the body (no JWT).
`NEW` = added, `CHANGED` = contract or behaviour changed, `REFERENCE` = unchanged but needed for the flows.
Full behaviour, errors and UI logic: `docs/mobile-app-kt.md`, `docs/admin-web-kt.md`, `docs/desktop-integration-changes.md`.

## Auth

### Login — `REFERENCE`

`POST {{baseUrl}}/auth/login` · auth: none

```json
{
  "agentId": "SUPERADMIN",
  "password": "<password>"
}
```

Returns accessToken (15 min) and refreshToken. Use it for every JWT request below; the Super Admin login is `SUPERADMIN`.

## Desktop (machine auth)

### Activate machine — `CHANGED`

`POST {{baseUrl}}/machines/activate` · auth: none (machine credentials in body)

```json
{
  "agentId": "CSP-001",
  "activationCode": "K7M2-QX9P-RT4W-HB3N",
  "activationPassword": "<from assign>",
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

Re-activating a registered PC (no active activation of the same owner type) issues a new apiKey that replaces the old one. Returns { machineCode, apiKey }.

### Machine heartbeat — `CHANGED`

`POST {{baseUrl}}/machines/runtime/heartbeat` · auth: none (machine credentials in body)

```json
{
  "machineCode": "{{machineCode}}",
  "apiKey": "{{apiKey}}",
  "fingerprint": "{{fingerprint}}",
  "watcherVersion": "1.0.0",
  "osName": "Windows",
  "osVersion": "10.0.19045",
  "deviceName": "DESKTOP-01",
  "ipAddress": "192.168.1.20"
}
```

Response adds planCode, subscriptionEndDate, graceEndsAt, features[].

### Entitlements — `NEW`

`POST {{baseUrl}}/machines/runtime/entitlements` · auth: none (machine credentials in body)

```json
{
  "machineCode": "{{machineCode}}",
  "apiKey": "{{apiKey}}",
  "fingerprint": "{{fingerprint}}"
}
```

Machine, activation, subscription + plan, full feature objects.

### Activity start (SBI login) — `NEW`

`POST {{baseUrl}}/machines/runtime/activity/start` · auth: none (machine credentials in body)

```json
{
  "machineCode": "{{machineCode}}",
  "apiKey": "{{apiKey}}",
  "fingerprint": "{{fingerprint}}",
  "agentId": "{{agentId}}"
}
```

201 { activitySessionId, startedAt, restarted, heartbeatInterval, heartbeatTimeout }. agentId must be the machine's assigned agent.

### Activity heartbeat — `NEW`

`POST {{baseUrl}}/machines/runtime/activity/heartbeat` · auth: none (machine credentials in body)

```json
{
  "machineCode": "{{machineCode}}",
  "apiKey": "{{apiKey}}",
  "fingerprint": "{{fingerprint}}",
  "activitySessionId": "{{activitySessionId}}"
}
```

Every 60 s. restarted=true → use the new id. 409 when the session was stopped/replaced.

### Activity stop — `NEW`

`POST {{baseUrl}}/machines/runtime/activity/stop` · auth: none (machine credentials in body)

```json
{
  "machineCode": "{{machineCode}}",
  "apiKey": "{{apiKey}}",
  "fingerprint": "{{fingerprint}}",
  "activitySessionId": "{{activitySessionId}}",
  "reason": "LOGOUT"
}
```

reason: LOGOUT | AUTO_LOGOUT | APP_CLOSE. Idempotent.

### Upload receipt counts — `NEW`

`POST {{baseUrl}}/receipts/upload-counts` · auth: none (machine credentials in body)

```json
{
  "machineCode": "{{machineCode}}",
  "apiKey": "{{apiKey}}",
  "fingerprint": "{{fingerprint}}",
  "agentId": "{{agentId}}",
  "receipts": [
    {
      "receiptId": "61631801122527224246673224",
      "receiptType": "AEPS",
      "transactionCategory": "CASH_WITHDRAWAL",
      "transactionType": "Cash Withdrawal",
      "rrn": "6163467244324489",
      "location": "RASULPUR",
      "transactionAt": "2026-10-25T10:00:00.000Z",
      "count": 1,
      "amount": 1000,
      "cashDenomination": {
        "notes500": 1,
        "notes100": 5
      }
    }
  ]
}
```

1–20 receipts; count must be 1; amount required for CASH_DEPOSIT / CASH_WITHDRAWAL / MONEY_TRANSFER. Needs an active machine session (send a heartbeat first). Agent can be a CSP or a KO.

### Upload receipts (legacy) — `CHANGED`

`POST {{baseUrl}}/receipts/upload` · auth: none (machine credentials in body)

```json
{
  "machineCode": "{{machineCode}}",
  "apiKey": "{{apiKey}}",
  "fingerprint": "{{fingerprint}}",
  "receipts": [
    {
      "receiptId": "R-1",
      "receiptType": "AEPS",
      "transactionCategory": "CASH_DEPOSIT",
      "transactionType": "Cash Deposit",
      "status": "SUCCESS",
      "transactionAt": "2026-10-25T10:00:00.000Z",
      "amount": 500
    }
  ]
}
```

Old watcher contract. 'No agent assigned' → 403 and 'No active machine session' → 400 (were 500).

## Plans & payments

### List plans — `CHANGED`

`GET {{baseUrl}}/subscriptions/plans` · auth: none

Query: `ownerType=CSP`

ownerType: CSP | BC. Now lists features; BC includes BC_CSP_LINK (₹799, 0 machines).

### Update plan pricing (Super Admin) — `NEW`

`PATCH {{baseUrl}}/subscriptions/plans/{{planId}}/pricing` · auth: Bearer token

```json
{
  "billingCycle": "HALF_YEARLY",
  "price": 4794,
  "durationDays": 180,
  "isActive": true
}
```

SUPER_ADMIN. durationDays required only when adding a new cycle.

### Create order — `CHANGED`

`POST {{baseUrl}}/payments/create-order` · auth: Bearer token

```json
{
  "planId": "{{planId}}",
  "billingCycle": "MONTHLY",
  "machineCount": 2
}
```

CSP_ADMIN / BC_ADMIN only. machineCount 1–100 for CSP plans (amount = price × machines); not allowed for BC plans.

### Verify payment — `REFERENCE`

`POST {{baseUrl}}/payments/verify` · auth: Bearer token

```json
{
  "paymentId": "{{paymentId}}",
  "gatewayTransactionId": "TEST-123"
}
```

Manual flow until Razorpay. Creates/renews the subscription and its activation codes.

### Current subscription — `REFERENCE`

`GET {{baseUrl}}/subscriptions/current` · auth: Bearer token

machineLimit = machines bought (CSP).

## Activations

### List activations — `CHANGED`

`GET {{baseUrl}}/activations` · auth: Bearer token

No password hash. DEV ONLY: includes activationPassword (removed before production).

### Activation detail — `CHANGED`

`GET {{baseUrl}}/activations/{{activationId}}` · auth: Bearer token

Same as list + canRegenerate.

### Assign activation — `CHANGED`

`POST {{baseUrl}}/activations/assign` · auth: Bearer token

```json
{
  "activationId": "{{activationId}}",
  "assignedAgentId": "KO-001"
}
```

Owner from the token. CSP → itself or its KOs; BC → agents of the BC. Returns code + password.

### Regenerate password — `REFERENCE`

`POST {{baseUrl}}/activations/{{activationId}}/regenerate-password` · auth: Bearer token

Only while NOT_ACTIVATED.

## Agents

### Create CSP / request link (BC) — `CHANGED`

`POST {{baseUrl}}/agents/csp` · auth: Bearer token

```json
{
  "agentId": "CSP-100",
  "name": "New CSP",
  "mobile": "9999999999",
  "email": "csp100@example.com",
  "address": "Bhubaneswar",
  "openingCash": 10000,
  "cashLimit": 50000,
  "machineCount": 1,
  "kos": [
    {
      "agentId": "KO-100",
      "name": "KO 100",
      "machineCount": 1
    }
  ]
}
```

New CSP → 201 { csp, kos }. Existing CSP → 202 { csp: null, kos: [], linkRequest } (admin approval; no kos allowed).

### Create KO (CSP) — `CHANGED`

`POST {{baseUrl}}/agents/ko` · auth: Bearer token

```json
{
  "agentId": "KO-200",
  "name": "KO 200",
  "mobile": "8888888888",
  "machineCount": 1
}
```

Works for CSPs with or without a BC.

### Update agent — `CHANGED`

`PATCH {{baseUrl}}/agents/{{agentId}}` · auth: Bearer token

```json
{
  "name": "Renamed",
  "address": "New address"
}
```

BC can't edit CSPs linked via a ₹799 request (or their KOs): 403 view-only. SUPER_ADMIN can edit any.

### Delete agent — `CHANGED`

`DELETE {{baseUrl}}/agents/{{agentId}}` · auth: Bearer token

Same view-only rule; delete KOs before their CSP.

### List agents — `CHANGED`

`GET {{baseUrl}}/agents` · auth: Bearer token

Query: `type=CSP`, `page=1`, `limit=20`

Never lists the admin's ADMIN record.

## BC links (₹799)

### Search subscribed CSPs (BC) — `NEW`

`GET {{baseUrl}}/bc-links/csps/search` · auth: Bearer token

Query: `search=CSP-TEST`

BC_ADMIN on a plan with CSP_LINKING. Returns agentId, name, address, koCount, linkStatus, hasPendingRequest.

### Create link request (BC) — `NEW`

`POST {{baseUrl}}/bc-links/requests` · auth: Bearer token

```json
{
  "cspAgentId": "CSP-TEST-003",
  "remarks": "Please link"
}
```

CSP must have an active own subscription. Linked to another BC → isConflict=true.

### List link requests — `NEW`

`GET {{baseUrl}}/bc-links/requests` · auth: Bearer token

Query: `status=PENDING`, `isConflict=true`, `bcId`, `cspAgentId`, `page=1`, `limit=20`

BC: own only. SUPER_ADMIN: all (bcId filter honoured). Remove empty params.

### Link request detail — `NEW`

`GET {{baseUrl}}/bc-links/requests/{{requestId}}` · auth: Bearer token

### Cancel link request (BC) — `NEW`

`POST {{baseUrl}}/bc-links/requests/{{requestId}}/cancel` · auth: Bearer token

Pending only.

### Approve link request (Super Admin) — `NEW`

`POST {{baseUrl}}/bc-links/requests/{{requestId}}/approve` · auth: Bearer token

```json
{
  "remarks": "Approved"
}
```

Links the CSP and all its KOs (linkedKoAgentIds in the response); moves it if linked to another BC. Body optional.

### Reject link request (Super Admin) — `NEW`

`POST {{baseUrl}}/bc-links/requests/{{requestId}}/reject` · auth: Bearer token

```json
{
  "remarks": "Not eligible"
}
```

Body optional.

## Dashboard & reports

### Dashboard summary — `CHANGED`

`GET {{baseUrl}}/dashboard/summary` · auth: Bearer token

Query: `from=2026-10-01`, `to=2026-10-25`, `agentId`

IST days; default today. CSP without CASH_MANAGEMENT gets float = null. BC gets cspSummary. SUPER_ADMIN gets all agents.

### Dashboard analytics — `CHANGED`

`GET {{baseUrl}}/dashboard/analytics` · auth: Bearer token

Query: `groupBy=day`, `from=2026-10-01`, `to=2026-10-25`

groupBy: hour | day | week | month | year; labels in IST.

### CSP monthly detail (BC) — `CHANGED`

`GET {{baseUrl}}/dashboard/csp/{{cspAgentId}}/detail` · auth: Bearer token

Query: `section=transaction`, `month=2026-10`

section: transaction | socialSecurity. IST month; moneyTransfer and fundTransfer columns.

### Report summary — `CHANGED`

`GET {{baseUrl}}/reports/summary` · auth: Bearer token

Query: `period=CURRENT_MONTH`

period: TODAY | YESTERDAY | CURRENT_MONTH | LAST_MONTH | CUSTOM (with from/to). Now applied (was ignored); IST; all CSPs for SUPER_ADMIN.

### Report export (xlsx) — `CHANGED`

`GET {{baseUrl}}/reports/export` · auth: Bearer token

Query: `period=CURRENT_MONTH`

Same query; returns an Excel file.

## Machines & receipts

### Machine list — `CHANGED`

`GET {{baseUrl}}/machines/list` · auth: Bearer token

Query: `page=1`, `limit=10`, `connectionStatus=ONLINE`

float = null for CSPs without CASH_MANAGEMENT. Use items[].machine.machineId.

### Machine detail — `CHANGED`

`GET {{baseUrl}}/machines/{{machineId}}` · auth: Bearer token

Query: `from=2026-10-25`, `to=2026-10-25`

Adds cspActivity { isActive, agentId, activeSince, activeSeconds }.

### Machine activity sessions — `NEW`

`GET {{baseUrl}}/machines/{{machineId}}/activity-sessions` · auth: Bearer token

Query: `from=2026-10-25`, `to=2026-10-25`

CSP SBI-login sessions for the machine.

### Receipt detail — `CHANGED`

`GET {{baseUrl}}/receipts/{{receiptId}}` · auth: Bearer token

Use receiptId. cashDenomination (null without CASH_MANAGEMENT for CSPs).

### Receipt list — `CHANGED`

`GET {{baseUrl}}/receipts` · auth: Bearer token

Query: `page=1`, `limit=20`, `transactionCategory=MONEY_TRANSFER`

Filters: from, to, machineId, receiptType, transactionCategory, status, search, agentId, sortBy, sortOrder.

## Visits, uploads, metrics

### Presign photo upload — `CHANGED`

`POST {{baseUrl}}/uploads/presigned-url` · auth: Bearer token

```json
{
  "fileName": "visit.jpg",
  "contentType": "image/jpeg"
}
```

Key is csp-visits/<yourAgentId>/YYYY/MM/<uuid>.jpg. Then POST multipart to uploadUrl with fields + file (last).

### Presigned download URL — `CHANGED`

`GET {{baseUrl}}/uploads/presigned-url` · auth: Bearer token

Query: `key=csp-visits/BC0001/2026/10/abc.jpg`

Own keys only (SUPER_ADMIN: any).

### Delete upload — `CHANGED`

`DELETE {{baseUrl}}/uploads` · auth: Bearer token

```json
{
  "key": "csp-visits/BC0001/2026/10/abc.jpg"
}
```

Own keys only.

### Create CSP visit — `CHANGED`

`POST {{baseUrl}}/csp-visits` · auth: Bearer token

```json
{
  "cspAgentId": "CSP-TEST-003",
  "visitDate": "2026-10-25T10:00:00.000Z",
  "photoUrl": "csp-visits/BC0001/2026/10/abc.jpg",
  "latitude": 20.29,
  "longitude": 85.82,
  "remarks": "Monthly visit",
  "customerReviews": [
    {
      "customerName": "A",
      "review": "Good"
    },
    {
      "customerName": "B",
      "review": "Good"
    },
    {
      "customerName": "C",
      "review": "Good"
    },
    {
      "customerName": "D",
      "review": "Good"
    },
    {
      "customerName": "E",
      "review": "Good"
    }
  ]
}
```

Owner-folder photo keys accepted (were rejected). ≥5 reviews; one visit per CSP per IST month.

### Metric values — `CHANGED`

`GET {{baseUrl}}/metrics/values` · auth: Bearer token

Query: `agentId`, `metricId`, `from=2026-10-01`, `to=2026-10-25`

Route-order fix (was 404 'Metric not found.') — in PR #4.

