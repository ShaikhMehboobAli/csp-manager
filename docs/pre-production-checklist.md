# Pre-Production Checklist — CSP Manager API

**Audience:** whoever prepares the backend (`apps/api`) for a production release.
**Purpose:** items that are acceptable in development but must be resolved or consciously accepted before go-live. Desktop-side items live in `docs/desktop-integration-changes.md`.
**Last updated:** 2026-10-30

Status: `OPEN` (must do), `DECIDE` (needs an owner decision), `DONE`.

## 1. Payments (Razorpay)

| # | Item | Status | Where |
|---|---|---|---|
| 1.1 | `POST /payments/verify` trusts the client's `gatewayTransactionId`. Verify the Razorpay payment signature (`razorpay_order_id` + `razorpay_payment_id` + `razorpay_signature`, HMAC-SHA256 with the key secret) before completing the payment. | OPEN | `src/modules/payments/payment.service.ts` `verifyPayment` |
| 1.2 | `create-order` creates a local MANUAL payment only. Create a real Razorpay order and store its `order_id` on the payment (`transactionReference` or a new column); set `paymentMethod/paymentProvider = RAZORPAY`. | OPEN | `payment.service.ts` `createOrder` |
| 1.3 | Webhook uses a shared secret header (`x-webhook-secret`). Replace with Razorpay signature verification (`x-razorpay-signature` over the **raw** request body; needs `express.raw()` for this route instead of `express.json()`). | OPEN | `src/modules/payments/webhook-auth.middleware.ts`, `payment.routes.ts`, `app.ts` |
| 1.4 | Webhook payload should be Razorpay's event shape (`payment.captured`, `payment.failed`, `order.paid`), mapped to our payment by order id, and must be idempotent (already handled for `SUCCESS`). | OPEN | `payment.service.ts` `webhook`, `validations/webhook-payment.validation.ts` |
| 1.5 | Handle failed/cancelled payments (mark `FAILED`/`CANCELLED`, store `failureReason`). Currently nothing sets these. | OPEN | `payment.service.ts` |
| 1.6 | Tax/GST: `taxAmount` is always 0 and `invoiceNumber` is never generated. | DECIDE | `payment.service.ts` |
| 1.8 | Double charging: `create-order` takes an optional `Idempotency-Key` header (unique per owner; a retry returns the same payment, a different order with the same key → 409) and is serialised per owner, so concurrent requests reuse one pending payment. `verify` and `webhook` lock the payment row, so a payment completes once; a `gatewayTransactionId` can complete only one payment (unique column, 409). The mobile app must send a fresh UUID per purchase attempt. Re-check all of this once Razorpay (1.1–1.4) is wired: the Razorpay order id must also be unique per payment. | DONE | `payment.service.ts`, `payment.repository.ts`, `payment.controller.ts` |
| 1.9 | **Retries and slow networks (checked 2026-10-30).** Safe today: `create-order` (Idempotency-Key, reused pending order, per-owner lock), `verify` (a retry with the same `gatewayTransactionId` returns the original 200; row lock), `webhook` (already-processed → 200). **Missing:** no retry/attempt counter, nothing ever marks a payment `FAILED` / `CANCELLED` (1.5), pending orders never expire, and nothing reconciles a payment whose app callback never arrived. With Razorpay add: (a) pending orders expire after 30 min (match the Razorpay order expiry) and are marked `CANCELLED`; (b) a reconcile job every 5 min fetches Razorpay order status for `PENDING` payments older than 2 min and completes or fails them; (c) the webhook stays the source of truth: the app's `verify` is only a fast path; (d) store each gateway attempt (Razorpay allows several attempts per order) so support can see failed tries. Client retry policy is in the mobile KT §6. | OPEN | `payment.service.ts`, `src/jobs/` |
| 1.7 | `PAYMENT_WEBHOOK_SECRET` (and later Razorpay key id/secret, webhook secret) set in the production environment, never committed. | OPEN | `.env` / deployment secrets |

## 2. Security and logging

| # | Item | Status | Where |
|---|---|---|---|
| 2.1 | Remove debug `console.log`s (owner will do this at the end). Includes `SubscriptionAccessValidator` logging the full subscription object and `"CSP VISIT ROUTES REGISTERED"`. | OPEN | `subscription-access-validator.ts`, `routes/index.ts`, `subscription.service.ts` `validateMachineLimit` |
| 2.2 | Stub endpoints in `app.ts` (`POST /receipt`, `POST /api/events`, `POST /api/auth/activate`, `GET /api/config/sync`) logged the raw request body and accepted anything. Removed (404); the desktop drops its event queue and `/config/sync`. | DONE | `src/app.ts` |
| 2.3 | Prisma logs every SQL query (`log: ["query", ...]`), which can include sensitive values. Use `["warn", "error"]` in production. | OPEN | `src/config/prisma.ts` |
| 2.4 | `JWT_SECRET` / `JWT_REFRESH_SECRET` default to `""` if unset. Fail at startup when missing. Access-token expiry is hard-coded to `15m` (ignores `JWT_ACCESS_EXPIRES_IN`). | OPEN | `src/config/env.ts`, `src/core/services/jwt.service.ts` |
| 2.5 | `cors()` allows every origin. Restrict to the real web/mobile origins. | OPEN | `src/app.ts` |
| 2.6 | Rate limits (`express-rate-limit`, 429): all `/api/v1` 600/min per IP; `/auth/*` 20 per 15 min per IP; `/machines/activate` 20 per 15 min per IP; machine runtime + receipt uploads 120/min per machine; `create-order` + `verify` 10/min per user. Before production: (a) the store is in-memory, so with more than one instance use a shared store (Redis); (b) behind a proxy/load balancer set `TRUST_PROXY` to the hop count, otherwise every client shares the proxy's IP; (c) tune the numbers against real traffic. | OPEN | `core/middlewares/rate-limit.middleware.ts`, `app.ts`, `config/env.ts` |
| 2.14 | **Push notifications** (not built; no provider chosen yet: FCM / Expo push). Needed for: (a) **activation revoke request raised** → notify the super admin(s); (b) **revoke request approved / rejected** → notify the requesting CSP / BC (include the activation code and, for approval, "the PC `<machineCode>` has stopped working"); (c) BC link request raised / approved / rejected (same pattern). Needs a device-token table + `POST /notifications/devices` (mobile KT §5.2), a send-on-event hook in `activation-revoke.service.ts` and `bc-link.service.ts` (after commit, never inside the DB transaction), and an in-app notification list as fallback. Until then the apps poll the request lists. | OPEN | `modules/activations/activation-revoke.service.ts`, `modules/bc-links/bc-link.service.ts` |
| 2.15 | Found in the full endpoint test (2026-10-30) and fixed: (a) **`POST /old-machines/activate`** (legacy, unused) activated a PC **without checking the activation password** or the subscription; route unmounted. (b) **`POST /agents/csp` / `/agents/ko` had no body validation**: a missing `agentId` reached Prisma as `undefined`, which matched the first agent in the table and raised a link request for an arbitrary CSP; zod schemas added. (c) **Login** told unknown IDs apart from wrong passwords (404 vs 403) and revealed account status before checking the password; now `403 Invalid credentials.` for both (constant-time dummy hash), status only after a correct password. (d) Invalid query strings and malformed JSON returned 500 (ZodError / body-parser); now 400 (413 for an oversized body). | DONE | `routes/index.ts`, `agents/validations/agent.validation.ts`, `auth.service.ts`, `errorHandler.ts` |
| 2.13 | **Security review planned** (owner, 2026-10-30): go through the API and the database before go-live. At least: auth and role checks on every route, input validation, error messages that leak internals, secrets handling, DB user privileges (the app should not connect as the DB owner), Neon IP allow-list / SSL, backups and point-in-time restore, dependency audit (`npm audit`), security headers, request size limits. The concrete plan is **section 5**. | OPEN | whole API, Neon |
| 2.7 | OTP is only printed to the console; no email/SMS provider. | OPEN | `src/core/services/email.service.ts` |
| 2.8 | No refresh-token endpoint; refresh tokens are issued but never stored or exchanged. | DECIDE | `auth.service.ts` |
| 2.9 | Existing JWTs stay valid for up to 15 min after a user is blocked/suspended. Acceptable, or check user status in `authMiddleware`. | DECIDE | `core/middlewares/auth.middleware.ts` |
| 2.10 | Production API base URL must be HTTPS (desktop and mobile). | OPEN | deployment |
| 2.11 | **DEV ONLY — remove before production:** activation passwords are stored in plain text (`Activation.activationPasswordPlain`) and returned as `activationPassword` by `GET /activations` and `GET /activations/:id`, so owners can see them until activation emails exist. Disabled when `NODE_ENV=production`, but before go-live: replace with emailing the password, delete `src/modules/activations/activation-password-exposure.ts` and its uses, drop the column (migration), and confirm `NODE_ENV=production` is set. | OPEN | `activation-password-exposure.ts`, `activation.repository.ts`, `activation.service.ts`, `prisma/schema.prisma` |
| 2.12 | Planned auth/notification endpoints (resend OTP, forgot/reset password, refresh token, push tokens, activation email) are documented in the app KTs but not built. Email is still a console stub. | OPEN | `src/modules/auth`, `core/services/email.service.ts` |

## 3. Database and deployment

| # | Item | Status | Where |
|---|---|---|---|
| 3.1 | Apply migrations with `npx prisma migrate deploy` (never `migrate dev`) against production. | OPEN | deployment |
| 3.2 | Seeding deactivates `CSP_BASIC` / `CSP_PRO` and old non-monthly pricings. Confirm no live customer is on them before seeding production. | DECIDE | `prisma/seeds/plan.seed.ts`, `pricing.seed.ts` |
| 3.3 | Non-monthly (half-yearly / yearly) **CSP** prices are not defined yet. BC ₹799 (`BC_CSP_LINK`) is seeded at 799 / 4794 / 9588 (monthly / half-yearly / yearly); SUPER_ADMIN sets real prices with `PATCH /subscriptions/plans/:planId/pricing`. Seeding never overwrites existing prices. | DECIDE | `prisma/seeds/data/plans.ts` |
| 3.4 | No automated tests exist. Add at least: receipt upload (both endpoints), ledger effect, subscription renew/upgrade/expiry, activation assign/activate. | OPEN | — |
| 3.5 | `apps/api/dist` was untracked from git; production builds should come from `npm run build` in CI, not a committed `dist/`. | DONE | `.gitignore` |
| 3.7 | Host the API in the same region as the Neon database (ap-southeast-1). From a remote location each query is ~75 ms and a 5-receipt `upload-counts` takes ~5 s; in-region it's a few ms. Transactions now allow 15 s and `upload-counts` is capped at 20 receipts. | OPEN | deployment |
| 3.8 | `upload-counts` and the legacy `/receipts/upload` used ~10–12 sequential queries per receipt; 20 cash receipts took >15 s from a local PC and failed with 500 (transaction timeout), which the desktop would retry forever. **Fixed 2026-10-30:** one insert for the batch (`createManyAndReturn`, duplicates skipped), one denomination insert, ledger computed in memory with the agent's float row-locked and written once (`FloatLedgerService.recordReceiptBatch`). 20 cash receipts now ≈ 2 s from a local PC; balances verified identical. | DONE | `receipt.service.ts`, `float-ledger.service.ts` |
| 3.9 | The Prisma client uses the `relationJoins` preview feature (includes load in one SQL query). The build/deploy must run `npx prisma generate` from the current schema, and re-check this flag on any Prisma upgrade. | OPEN | `prisma/schema.prisma` |
| 3.10 | Plan features are cached in-process for 60 s, so admin edits to a plan's features take up to a minute (per instance) to apply. | DECIDE | `subscription-entitlement.service.ts` |
| 3.11 | Legacy BC plans (`BC_BASIC`, `BC_PRO`) carry the four desktop features as explicit plan features; `BC_CSP_LINK` has `CSP_LINKING` + `CASH_MANAGEMENT`. Run `npx prisma db seed` after deploying so these plan-feature links exist. | OPEN | `prisma/seeds/data/plans.ts` |
| 3.12 | Desktop settings (`AppSetting` key `desktop`: global service switches, `minimumVersion`, `latestWatcherVersion`, `downloadUrl`, `portalUrl`) are cached in-process for 60 s; other instances pick up a super admin change within a minute. Set `latestWatcherVersion` / `downloadUrl` for the production installer; `portalUrl` stays null until the web portal exists. | OPEN | `modules/settings/desktop-settings.service.ts` |
| 3.13 | **Database timeouts.** On 2026-10-30 a Neon pooled connection dropped in the middle of a `create-order` transaction; the server-side transaction stayed open holding the payment running-number row lock, and the next `create-order` waited ~4 minutes (500). Set on the production app role: `ALTER ROLE <app> SET idle_in_transaction_session_timeout = '30s'; ALTER ROLE <app> SET lock_timeout = '10s'; ALTER ROLE <app> SET statement_timeout = '20s';` (and the same on the dev database once agreed), so an orphaned transaction is killed quickly and waiters fail fast instead of hanging. | OPEN | Neon / DB role |
| 3.14 | Every interactive transaction uses the shared 15 s limit (`withTransaction` / `TRANSACTION_OPTIONS`). `agent.service.ts` used Prisma's 5 s default and failed KO/CSP creation intermittently from a remote DB; fixed 2026-10-30. Use `withTransaction` for any new transaction. | DONE | `core/database/transaction.ts` |
| 3.6 | Subscription expiry runs hourly in-process (`node-cron`). If the API runs as multiple instances, make sure only one runs jobs (or the jobs are safe to run concurrently — current ones are idempotent). | DECIDE | `src/jobs/*`, `src/server.ts` |

## 4. Product rules to confirm

| # | Item | Status |
|---|---|---|
| 4.1 | Grace period after subscription end (currently none). | DECIDE |
| 4.2 | Upgrade gives no credit/refund for unused days of the old plan. | DECIDE |
| 4.4 | No RM / Network Manager role exists. Metric definitions are SUPER_ADMIN-only until it does. | DECIDE |
| 4.6 | A BC linking an **existing** CSP always needs SUPER_ADMIN approval: `POST /agents/csp` with an existing CSP now returns 202 and creates a `BC_MANAGED` link request (KOs must be added after approval); `/bc-links/requests` creates `SUBSCRIBED_CSP` requests. Only CSPs the BC creates are linked immediately. SUPER_ADMIN calling `POST /agents/csp` still links directly. | DONE |
| 4.7 | Link requests are approved by SUPER_ADMIN only; CSP-side approval is planned later. | DECIDE |
| 4.8 | SUPER_ADMIN isn't gated by a subscription: `SubscriptionAccessValidator` skips the admin's own (absent) subscription using a per-request user context (`core/context/request-context.ts`); other owners' subscriptions checked during an admin request are still validated. | DONE |
| 4.9 | SUPER_ADMIN account: `npm run seed:super-admin` with `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (≥12 chars), optional `SUPER_ADMIN_AGENT_ID` (default `SUPERADMIN`) and `SUPER_ADMIN_RESET_PASSWORD=true`; also runs from `prisma db seed` when the env vars are set. Created in dev on 2026-10-25. **Create production credentials separately; never reuse dev ones.** | DONE |
| 4.10 | Day boundaries are IST (`Asia/Kolkata`) for dashboards, reports, CSP monthly detail, analytics labels, machine analytics and the one-visit-per-month rule (`core/utils/ist.ts`). | DONE |
| 4.11 | CSP plans are priced **per machine**: `create-order` takes `machineCount` (1–100), amount = price × machines, the subscription gets that many activations. Buying a different machine count while a plan runs starts a new subscription now (old one ends, activated machines carry over, no credit). Confirm the no-credit rule for adding machines mid-term. | DECIDE |
| 4.12 | `GET /reports/summary` accepts `cspAgentId` but never applied it. | OPEN |
| 4.5 | Uploads created before 2026-10-25 have keys without the owner folder (`csp-visits/<year>/...`). Only SUPER_ADMIN can fetch them directly; visit detail still serves them. Re-key or accept for any non-test data. | DECIDE |
| 4.3 | Money Transfer and Fund Transfer shown as separate columns in dashboard CSP summary, CSP monthly detail, and reports (JSON + Excel). | DONE |

## 5. Security hardening plan (before go-live)

Owner request 2026-10-30: secure the desktop ↔ server channel, keep the app out of security trouble, and make sure DB data can't leak. Items marked **must** block go-live.

### 5A. Desktop ↔ server (machine authentication)

**Today:** every desktop call carries `machineCode`, `apiKey` and `fingerprint` in the JSON body. `machineCode` and `fingerprint` aren't secret (they appear in logs, screenshots and the web app), so the **`apiKey` alone is the credential**. It never expires, is sent on every request, is stored in `MachineConfig.json` on the PC, and the test server runs on plain `http://`. Whoever reads one request off the network, or copies the config file, can act as that PC (fake receipts, hold sessions) until the key is revoked. The server bcrypt-checks the key on every call (~50–100 ms CPU each), which also makes key guessing a cheap DoS.

| # | Item | Priority | Status |
|---|---|---|---|
| 5A.1 | **HTTPS only** (TLS 1.2+, valid certificate, HSTS). The production desktop build refuses `http://` base URLs; remove the test-server override (desktop `preproductioncheck` item 5). | must | OPEN |
| 5A.2 | Desktop stores `ApiKey` with **DPAPI** (`ProtectedData`, LocalMachine scope so the service can read it) and restricts `MachineConfig.json` to SYSTEM + Administrators. | must | OPEN (desktop) |
| 5A.3 | Machine credentials in headers (`X-Machine-Code`, `X-Machine-Fingerprint`, `Authorization: Machine <apiKey>`) are accepted alongside the body (`core/middlewares/machine-credentials.middleware.ts`); a header that contradicts the body → 400. Still to do: redact these headers in any request logger added later (morgan `dev` doesn't log headers). | must | DONE (backend) |
| 5A.4 | **Signed requests with a device key** (replaces sending the key). At activation the desktop creates a non-exportable ECDSA P-256 key (Windows CNG, TPM-backed when available) and sends only the **public** key; the server stores it. Every request then sends `X-Machine-Code`, `X-Timestamp`, `X-Nonce` and `X-Signature` = sign(method + path + timestamp + nonce + SHA-256(body)). The server verifies the signature, rejects timestamps more than 5 min off and nonces seen in the last 10 min. Result: captured traffic can't be replayed, a copied config file doesn't work on another PC (key stays in the TPM), and a database leak exposes no usable machine secret. Signature checks are also far cheaper than bcrypt. Needs a desktop release; keep `apiKey` auth as a fallback for one release, then switch it off. **Approved 2026-10-30. Backend built** (`core/security/machine-signature.ts`, `Machine.devicePublicKey`, desktop doc item #19). A machine with a registered key can no longer use its `apiKey` alone. **Before production:** (a) the desktop ships item #19; (b) set `MACHINE_SIGNATURE_REQUIRED=true` so unsigned machines are refused (they re-activate once); (c) the replay-nonce cache is in-memory per process: move it to Redis (section 6) when running more than one instance; (d) servers need correct time (NTP), since timestamps older than 5 min are refused. | must | DONE (backend) · desktop OPEN |
| 5A.5 | Anomaly alerts: the same machine seen from a new public IP or country, many failed auth attempts for one `machineCode`, heartbeats from two IPs at once. Auto-block a machine after N failures; the owner re-activates. | should | OPEN |
| 5A.6 | Optional later: certificate pinning in the desktop, or mutual TLS with a per-machine client certificate. | could | DECIDE |
| 5A.7 | Done: per-machine rate limits, revoke (super admin approved), re-activation rotates the key and closes old sessions, watcher-only endpoints gated server-side. | — | DONE |

### 5B. API and app

| # | Item | Priority | Status |
|---|---|---|---|
| 5B.1 | Dependencies. `npm audit` on 2026-10-30 found 12 (1 critical, 7 high, 4 moderate). **`npm audit fix` applied** the same day (non-breaking; `@prisma/client` and `prisma` now 6.19.3, `express` deps patched, `zod` 4.6.7): the critical `proxy-addr` and the `body-parser`, `zod`, `brace-expansion`, `effect` issues are fixed. **Left (need a major upgrade):** `deepmerge-ts` (high) inside the Prisma CLI `@prisma/config` (build-time tool, not in the request path; fixed by moving to Prisma 7, plan it as its own task) and `uuid` (moderate) inside `exceljs` (affects `uuid` v3/v5/v6 with a caller buffer; low risk for Excel export; watch for an `exceljs` release). Add Dependabot / an `npm audit --omit=dev --audit-level=high` CI step. | must | PARTLY DONE |
| 5B.2 | Secrets: `JWT_SECRET` / `JWT_REFRESH_SECRET` ≥ 32 random bytes, fail at startup if missing (2.4); all secrets in the host's secret manager, never in the repo; rotate every secret that has been on a dev machine (DB password, JWT, AWS, webhook) before go-live. | must | OPEN |
| 5B.3 | Auth: refresh-token rotation stored server-side (2.8); check user/agent status in `authMiddleware` (2.9); OTP: expiry ≤ 5 min, max 5 attempts per OTP, then a new one; password policy; **2FA for SUPER_ADMIN**. | must | OPEN |
| 5B.4 | Authorization tests per route: every `:id` route checked for cross-tenant access (IDOR) with a CSP, a KO's CSP, a BC and another BC. | must | OPEN |
| 5B.5 | Input: every route validates its body/query with zod (some controllers parse inline; keep it that way, no raw `req.body` to Prisma); set `express.json({ limit: "100kb" })` explicitly; upload content-type and size limits on presigned POSTs. | must | OPEN |
| 5B.6 | CORS allow-list (2.5); keep `helmet`; no stack traces or Prisma messages in error responses (current handler is fine; keep it). | must | OPEN |
| 5B.7 | Logging: Prisma query logs off in production (2.3); remove `console.log` of request bodies (2.1); redact `password`, `activationPassword`, `apiKey`, `token`, `authorization` in any logger; ship logs to a central store with 90-day retention. | must | OPEN |
| 5B.8 | Audit log for admin and money actions: approve/reject (links, revokes), direct revoke, desktop settings changes, plan pricing, payment status changes, with who/when/before/after (the `AuditLog` table exists but isn't written). | should | OPEN |
| 5B.9 | Edge protection: put the API behind Cloudflare (or the host's WAF) for DDoS and bot filtering; rate limits move to a shared store (2.6). | should | OPEN |
| 5B.10 | Monitoring: error tracking (Sentry), uptime checks, alerts on 5xx rate, 429 spikes, auth failures. | should | OPEN |
| 5B.11 | External penetration test (or at least OWASP ZAP baseline + manual auth tests) before launch. | should | OPEN |

### 5C. Database (Neon)

| # | Item | Priority | Status |
|---|---|---|---|
| 5C.1 | **Separate production project** from dev; no production data copied to dev. | must | OPEN |
| 5C.2 | **Least-privilege roles:** the API connects as an app role with only SELECT/INSERT/UPDATE/DELETE on the app tables; migrations run with a separate owner role from CI only. The app must not connect as the database owner. | must | OPEN |
| 5C.3 | Connections: `sslmode=require` (and `channel_binding=require`); Neon **IP allow-list** so only the API host (and CI for migrations) can connect. | must | OPEN |
| 5C.4 | Rotate the database password before go-live (the dev URL has been on developer machines and in tools). | must | OPEN |
| 5C.5 | Backups: confirm point-in-time restore window on the Neon plan, and do one restore drill into a scratch branch. | must | OPEN |
| 5C.6 | Sensitive data: customer name / account number on receipts, agent mobile/email. Store only what's needed (the desktop's minimal upload sends none); mask account numbers (last 4) if stored; consider column encryption for any full account numbers. Remove plaintext activation passwords (2.11). | must | OPEN |
| 5C.7 | Retention: the session/receipt retention jobs (`SESSION_RETENTION_DAYS`, `RECEIPT_RETENTION_DAYS`, `CLEANUP_DRY_RUN`) set deliberately for production. | should | DECIDE |
| 5C.8 | Access: only named people get console access to the production project, with 2FA on the Neon account; no shared logins. | must | OPEN |

## 6. Infrastructure, plans and subscriptions to buy before release

Everything runs on local computers today (local API, Neon free/dev project, test server `http://192.168.1.8:3000`). Before release these accounts/plans are needed. Compare current prices and Indian billing (GST invoice) when buying; choose ap-south-1 (Mumbai) or ap-southeast-1 (Singapore) and keep the API and database in the **same region** (3.7).

| # | What | Why it's needed | Options | Status |
|---|---|---|---|---|
| 6.1 | **API hosting** (always-on server or container, ≥ 1 vCPU / 1–2 GB RAM to start, 2 instances for uptime later) | the API, cron jobs (3.6), HTTPS endpoint for desktop + apps | AWS (EC2 / ECS / App Runner), Render, Railway, Fly.io, DigitalOcean | OPEN |
| 6.2 | **Domain name** + DNS | `api.<domain>` for desktop/mobile, `admin.<domain>`, later the web portal (`portalUrl`) | any registrar; DNS on Cloudflare | OPEN |
| 6.3 | **TLS certificate** | HTTPS is mandatory (5A.1, 2.10) | free via Let's Encrypt / Cloudflare / AWS ACM | OPEN |
| 6.4 | **Neon paid plan, production project** | production data separate from dev (5C.1), point-in-time restore (5C.5), IP allow-list (5C.3), no auto-suspend cold starts, enough storage/compute | Neon paid tier that includes IP Allow and the PITR window you want (check the plan table) | OPEN |
| 6.5 | **Redis** (managed) | shared store for rate limits (2.6) and signed-request nonces (5A.4) once there is more than one API instance; also useful for the plan/settings caches (3.10, 3.12) | Upstash, Redis Cloud, AWS ElastiCache | OPEN (needed at 2+ instances) |
| 6.6 | **Razorpay account** (business KYC, live keys, webhook) | real payments (section 1) | Razorpay | OPEN |
| 6.7 | **SMS / OTP provider** with **DLT registration** (India: entity + sender ID + templates on a DLT portal) | signup/login OTP, forgot password (2.7, 2.12) | MSG91, Twilio, Gupshup, AWS SNS (DLT still required) | OPEN |
| 6.8 | **Email provider** + domain SPF/DKIM | activation code + password emails (replaces 2.11), receipts/invoices | AWS SES, Resend, SendGrid, Postmark | OPEN |
| 6.9 | **Push notifications** | revoke / link request alerts (2.14) | Firebase Cloud Messaging (free) or Expo push; needs a Firebase project + APNs key | OPEN |
| 6.10 | **AWS S3** (production bucket, private, separate from dev) | CSP visit photos (already used) | AWS S3 (existing account) | OPEN |
| 6.11 | **Secrets manager** | DB URL, JWT secrets, Razorpay, AWS, webhook secret (5B.2) | the host's secret store, AWS Secrets Manager / SSM, Doppler | OPEN |
| 6.12 | **Error tracking + uptime monitoring + logs** | 5B.10, 5B.7 | Sentry, Better Stack / UptimeRobot, the host's log service | OPEN |
| 6.13 | **Cloudflare** (free or Pro) in front of the API | DDoS / bot protection, WAF rules (5B.9) | Cloudflare | OPEN |
| 6.14 | **Windows code-signing certificate** (OV or EV) | sign the desktop installer and service so Windows SmartScreen and antivirus don't block them; also proves updates come from you (`downloadUrl`) | DigiCert, Sectigo, SSL.com; or Azure Trusted Signing | OPEN |
| 6.15 | **Google Play developer account** and **Apple Developer Program** | publish the React Native app | Google (one-time fee), Apple (yearly) | OPEN |
| 6.16 | **CI/CD** | build, `prisma migrate deploy` (3.1), `npm audit`, tests, deploy | GitHub Actions | OPEN |
| 6.17 | Installer download hosting | `downloadUrl` for desktop updates (18) | S3 + CloudFront, or the release page | OPEN |

### 6A. Production environment variables

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` (also hides dev activation passwords, 2.11) |
| `DATABASE_URL` | production Neon app-role URL, `sslmode=require` (5C.2, 5C.3) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | ≥ 32 random bytes each, new for production (5B.2) |
| `TRUST_PROXY` | number of proxies in front of the API (e.g. `1` behind a load balancer, `2` behind Cloudflare + load balancer) (2.6) |
| `MACHINE_SIGNATURE_REQUIRED` | `true` once the signed desktop release is out (5A.4) |
| `PAYMENT_WEBHOOK_SECRET` + Razorpay keys | from Razorpay (1.7) |
| `AWS_*` | production bucket credentials (least privilege: that bucket only) |
| `LATEST_WATCHER_VERSION` | fallback only; the super admin sets versions in the console |
| `CLEANUP_DRY_RUN`, `*_RETENTION_DAYS` | chosen retention (5C.7) |

### 6B. Go-live order (suggested)

1. Buy/set up 6.1–6.4, 6.11; create the production Neon project with an app role; set 6A variables.
2. Deploy the API over HTTPS; `npx prisma migrate deploy`; `npx prisma db seed`; `npm run seed:super-admin` with **new** credentials (4.9).
3. Razorpay live keys + webhook (section 1), SMS/OTP (6.7), email (6.8).
4. Ship the desktop release with HTTPS-only, DPAPI and the device key (desktop item #19), signed with 6.14; set `latestWatcherVersion` / `minimumVersion` / `downloadUrl` in the console.
5. Set `MACHINE_SIGNATURE_REQUIRED=true` once all live PCs are on the signed release.
6. Publish the mobile app (6.15) and the admin console.
7. Run the section 5 checks (pentest, restore drill) before announcing.

---

## Changelog

- 2026-10-25 — Initial version.
- 2026-10-25 — 4.3 DONE: money/fund transfer columns added.
- 2026-10-25 — Added 3.7 (co-locate API with DB) and 3.8 (per-receipt query count) after a P2028 transaction timeout on `upload-counts`.
- 2026-10-25 — Added 4.4 (no RM role) and 4.5 (legacy upload keys) after the authorization pass.
- 2026-10-25 — Added 3.9 (`relationJoins` needs `prisma generate`) and 3.10 (60 s plan-feature cache) after the performance pass.
- 2026-10-25 — Added 3.11 (BC plans include all features) with the KO/BC desktop upload fix.
- 2026-10-25 — BC ₹799 plan built: 3.3 and 3.11 updated; added 4.6 (legacy direct CSP linking bypasses approval) and 4.7 (CSP approval later).
- 2026-10-25 — 4.6 DONE: existing-CSP linking through `POST /agents/csp` goes through admin approval too.
- 2026-10-25 — Added 4.8 (SUPER_ADMIN blocked by subscription checks), 4.9 (no SUPER_ADMIN seed), 4.10 (UTC day boundaries) while writing the mobile/admin KTs.
- 2026-10-30 — Full endpoint test (193 checks): added 2.15 (fixed: legacy activation without password, unvalidated agent create, login enumeration, 500s for bad input), 3.8 DONE (batched receipt uploads), 3.13 (DB timeouts after a hung transaction), 3.14 (agent transactions used a 5 s timeout).
- 2026-10-30 — Signed desktop requests built (5A.3, 5A.4 backend done; `MACHINE_SIGNATURE_REQUIRED`); `npm audit fix` applied (5B.1, 2 issues left that need major upgrades); added section 6 (infrastructure, plans and subscriptions, production env vars, go-live order).
- 2026-10-30 — Activation revoke now needs super admin approval; added 1.9 (payment retries: what's safe, what's missing), 2.14 (push notifications for revoke and link requests), section 5 (security hardening: desktop channel, API, database) with the `npm audit` result.
- 2026-10-30 — Desktop requirements: 2.2 DONE (stubs removed); 2.6 rate limits added (Redis / `TRUST_PROXY` before production); added 1.8 (payment idempotency, DONE), 2.13 (security review), 3.12 (desktop settings cache).
- 2026-10-25 — 4.8–4.10 DONE (super admin access + account, IST days); added 2.11 (remove plain activation passwords), 2.12 (planned auth endpoints), 4.11 (per-machine CSP pricing), 4.12.
