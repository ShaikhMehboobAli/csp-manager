-- AlterEnum
ALTER TYPE "MandateStatus" ADD VALUE 'REPLACED';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'MANDATE_REPLACED';

-- Renewal retries no longer keep the plan usable: CSP subscriptions renewing
-- by mandate stop on their end date until the charge succeeds.
UPDATE "Subscription"
SET "graceEndsAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
WHERE "ownerType" = 'CSP'
  AND "autoRenew" = true
  AND "cancelledAt" IS NULL
  AND "lapsedAt" IS NULL
  AND "status" = 'ACTIVE';
