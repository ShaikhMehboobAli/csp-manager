-- CreateEnum
CREATE TYPE "TrialIdentityKind" AS ENUM ('AGENT_ID', 'PHONE', 'EMAIL', 'MACHINE_FINGERPRINT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'TRIAL_STARTED';
ALTER TYPE "NotificationKind" ADD VALUE 'TRIAL_ENDING';
ALTER TYPE "NotificationKind" ADD VALUE 'TRIAL_EXTENDED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionEventType" ADD VALUE 'TRIAL_STARTED';
ALTER TYPE "SubscriptionEventType" ADD VALUE 'TRIAL_EXTENDED';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "trialReminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TrialUsage" (
    "id" TEXT NOT NULL,
    "kind" "TrialIdentityKind" NOT NULL,
    "value" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "ownerType" "SubscriptionOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrialUsage_ownerId_idx" ON "TrialUsage"("ownerId");

-- CreateIndex
CREATE INDEX "TrialUsage_subscriptionId_idx" ON "TrialUsage"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrialUsage_kind_value_key" ON "TrialUsage"("kind", "value");

