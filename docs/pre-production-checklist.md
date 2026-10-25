# Pre-Production Checklist — CSP Manager API

**Audience:** whoever prepares the backend (`apps/api`) for a production release.
**Purpose:** items that are acceptable in development but must be resolved or consciously accepted before go-live. Desktop-side items live in `docs/desktop-integration-changes.md`.
**Last updated:** 2026-10-25

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
| 1.7 | `PAYMENT_WEBHOOK_SECRET` (and later Razorpay key id/secret, webhook secret) set in the production environment, never committed. | OPEN | `.env` / deployment secrets |

## 2. Security and logging

| # | Item | Status | Where |
|---|---|---|---|
| 2.1 | Remove debug `console.log`s (owner will do this at the end). Includes `SubscriptionAccessValidator` logging the full subscription object and `"CSP VISIT ROUTES REGISTERED"`. | OPEN | `subscription-access-validator.ts`, `routes/index.ts`, `subscription.service.ts` `validateMachineLimit` |
| 2.2 | Stub endpoints in `app.ts` (`POST /receipt`, `POST /api/events`, `POST /api/auth/activate`, `GET /api/config/sync`) log the raw request body and accept anything. Remove, or confirm the old watcher still needs them. | DECIDE | `src/app.ts` |
| 2.3 | Prisma logs every SQL query (`log: ["query", ...]`), which can include sensitive values. Use `["warn", "error"]` in production. | OPEN | `src/config/prisma.ts` |
| 2.4 | `JWT_SECRET` / `JWT_REFRESH_SECRET` default to `""` if unset. Fail at startup when missing. Access-token expiry is hard-coded to `15m` (ignores `JWT_ACCESS_EXPIRES_IN`). | OPEN | `src/config/env.ts`, `src/core/services/jwt.service.ts` |
| 2.5 | `cors()` allows every origin. Restrict to the real web/mobile origins. | OPEN | `src/app.ts` |
| 2.6 | No rate limiting on `/auth/login`, `/auth/verify-otp`, `/auth/signup`, `/machines/activate` (activation password brute force). | OPEN | `src/app.ts` / route level |
| 2.7 | OTP is only printed to the console; no email/SMS provider. | OPEN | `src/core/services/email.service.ts` |
| 2.8 | No refresh-token endpoint; refresh tokens are issued but never stored or exchanged. | DECIDE | `auth.service.ts` |
| 2.9 | Existing JWTs stay valid for up to 15 min after a user is blocked/suspended. Acceptable, or check user status in `authMiddleware`. | DECIDE | `core/middlewares/auth.middleware.ts` |
| 2.10 | Production API base URL must be HTTPS (desktop and mobile). | OPEN | deployment |

## 3. Database and deployment

| # | Item | Status | Where |
|---|---|---|---|
| 3.1 | Apply migrations with `npx prisma migrate deploy` (never `migrate dev`) against production. | OPEN | deployment |
| 3.2 | Seeding deactivates `CSP_BASIC` / `CSP_PRO` and old non-monthly pricings. Confirm no live customer is on them before seeding production. | DECIDE | `prisma/seeds/plan.seed.ts`, `pricing.seed.ts` |
| 3.3 | Non-monthly (half-yearly / yearly) CSP prices and the BC ₹799 plan rules are not defined yet. | DECIDE | `prisma/seeds/data/plans.ts` |
| 3.4 | No automated tests exist. Add at least: receipt upload (both endpoints), ledger effect, subscription renew/upgrade/expiry, activation assign/activate. | OPEN | — |
| 3.5 | `apps/api/dist` was untracked from git; production builds should come from `npm run build` in CI, not a committed `dist/`. | DONE | `.gitignore` |
| 3.7 | Host the API in the same region as the Neon database (ap-southeast-1). From a remote location each query is ~75 ms and a 5-receipt `upload-counts` takes ~5 s; in-region it's a few ms. Transactions now allow 15 s and `upload-counts` is capped at 20 receipts. | OPEN | deployment |
| 3.8 | `upload-counts` makes ~8 sequential queries per receipt (insert, re-read, denomination, ledger reads/writes). Batch these if larger uploads are ever needed. | DECIDE | `receipt.service.ts`, `float-ledger.service.ts` |
| 3.9 | The Prisma client uses the `relationJoins` preview feature (includes load in one SQL query). The build/deploy must run `npx prisma generate` from the current schema, and re-check this flag on any Prisma upgrade. | OPEN | `prisma/schema.prisma` |
| 3.10 | Plan features are cached in-process for 60 s, so admin edits to a plan's features take up to a minute (per instance) to apply. | DECIDE | `subscription-entitlement.service.ts` |
| 3.6 | Subscription expiry runs hourly in-process (`node-cron`). If the API runs as multiple instances, make sure only one runs jobs (or the jobs are safe to run concurrently — current ones are idempotent). | DECIDE | `src/jobs/*`, `src/server.ts` |

## 4. Product rules to confirm

| # | Item | Status |
|---|---|---|
| 4.1 | Grace period after subscription end (currently none). | DECIDE |
| 4.2 | Upgrade gives no credit/refund for unused days of the old plan. | DECIDE |
| 4.4 | No RM / Network Manager role exists. Metric definitions are SUPER_ADMIN-only until it does. | DECIDE |
| 4.5 | Uploads created before 2026-10-25 have keys without the owner folder (`csp-visits/<year>/...`). Only SUPER_ADMIN can fetch them directly; visit detail still serves them. Re-key or accept for any non-test data. | DECIDE |
| 4.3 | Money Transfer and Fund Transfer shown as separate columns in dashboard CSP summary, CSP monthly detail, and reports (JSON + Excel). | DONE |

---

## Changelog

- 2026-10-25 — Initial version.
- 2026-10-25 — 4.3 DONE: money/fund transfer columns added.
- 2026-10-25 — Added 3.7 (co-locate API with DB) and 3.8 (per-receipt query count) after a P2028 transaction timeout on `upload-counts`.
- 2026-10-25 — Added 4.4 (no RM role) and 4.5 (legacy upload keys) after the authorization pass.
- 2026-10-25 — Added 3.9 (`relationJoins` needs `prisma generate`) and 3.10 (60 s plan-feature cache) after the performance pass.
