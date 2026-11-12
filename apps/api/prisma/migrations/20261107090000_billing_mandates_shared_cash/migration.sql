-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('PURCHASE', 'UPGRADE', 'RENEWAL');

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'REVOKED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MandateProvider" AS ENUM ('RAZORPAY', 'MANUAL');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('GENERAL', 'CASH_ACTIVATION_DIFFERENCE', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_RENEWAL_FAILED', 'SUBSCRIPTION_LAPSED', 'SUBSCRIPTION_CANCELLED', 'MANDATE_REVOKED');

-- CreateEnum
CREATE TYPE "CashLoginMethod" AS ENUM ('KIOSK', 'EMAIL_OTP');

-- CreateEnum
CREATE TYPE "AgentOtpPurpose" AS ENUM ('EMAIL_VERIFICATION', 'CASH_LOGIN');

-- CreateEnum
CREATE TYPE "CashAdjustmentSource" AS ENUM ('KO_CREATION', 'CSP_EDIT', 'CSP_INCREASE', 'CSP_DECREASE');

-- CreateEnum
CREATE TYPE "CashAdjustmentStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CashLedgerType" ADD VALUE 'INCREASE';
ALTER TYPE "CashLedgerType" ADD VALUE 'DECREASE';
ALTER TYPE "CashLedgerType" ADD VALUE 'DRAWER_ADJUSTED';
ALTER TYPE "CashLedgerType" ADD VALUE 'AGENT_REMOVED';
ALTER TYPE "CashLedgerType" ADD VALUE 'AGENT_TRANSFERRED';
ALTER TYPE "CashLedgerType" ADD VALUE 'TRANSFER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionEventType" ADD VALUE 'RENEWAL_FAILED';
ALTER TYPE "SubscriptionEventType" ADD VALUE 'LAPSED';

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "cashAgentId" TEXT,
ADD COLUMN     "cashAgentLoginAt" TIMESTAMP(3),
ADD COLUMN     "cashAgentLoginMethod" "CashLoginMethod";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "data" JSONB,
ADD COLUMN     "kind" "NotificationKind" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "attemptNumber" INTEGER,
ADD COLUMN     "mandateId" TEXT,
ADD COLUMN     "previousMachineCount" INTEGER,
ADD COLUMN     "previousPlanId" TEXT,
ADD COLUMN     "purpose" "PaymentPurpose" NOT NULL DEFAULT 'PURCHASE';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "currentPeriodStart" TIMESTAMP(3),
ADD COLUMN     "lapsedAt" TIMESTAMP(3),
ADD COLUMN     "lastRenewalFailure" TEXT,
ADD COLUMN     "nextRenewalAttemptAt" TIMESTAMP(3),
ADD COLUMN     "pricePerMachine" DECIMAL(10,2),
ADD COLUMN     "renewalAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SubscriptionMandate" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "provider" "MandateProvider" NOT NULL,
    "providerMandateId" TEXT,
    "providerCustomerId" TEXT,
    "status" "MandateStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "amountChangePending" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "authUrl" TEXT,
    "activatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionMandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEmailOtp" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "AgentOtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "machineId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEmailOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDrawerAdjustment" (
    "id" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "source" "CashAdjustmentSource" NOT NULL,
    "status" "CashAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "cashInHandBefore" DECIMAL(14,2) NOT NULL,
    "cashInHandAfter" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "drawerBefore" JSONB NOT NULL,
    "drawerAfter" JSONB,
    "remarks" TEXT,
    "requestedBy" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashDrawerAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionMandate_providerMandateId_key" ON "SubscriptionMandate"("providerMandateId");

-- CreateIndex
CREATE INDEX "SubscriptionMandate_subscriptionId_idx" ON "SubscriptionMandate"("subscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionMandate_ownerId_idx" ON "SubscriptionMandate"("ownerId");

-- CreateIndex
CREATE INDEX "SubscriptionMandate_status_idx" ON "SubscriptionMandate"("status");

-- CreateIndex
CREATE INDEX "AgentEmailOtp_agentId_purpose_createdAt_idx" ON "AgentEmailOtp"("agentId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "CashDrawerAdjustment_agentId_status_idx" ON "CashDrawerAdjustment"("agentId", "status");

-- CreateIndex
CREATE INDEX "CashDrawerAdjustment_cspAgentId_status_idx" ON "CashDrawerAdjustment"("cspAgentId", "status");

-- CreateIndex
CREATE INDEX "Payment_mandateId_idx" ON "Payment"("mandateId");

-- AddForeignKey
ALTER TABLE "SubscriptionMandate" ADD CONSTRAINT "SubscriptionMandate_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "SubscriptionMandate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEmailOtp" ADD CONSTRAINT "AgentEmailOtp_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerAdjustment" ADD CONSTRAINT "CashDrawerAdjustment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: the current period of running subscriptions starts at their start date.
UPDATE "Subscription" SET "currentPeriodStart" = "startDate" WHERE "currentPeriodStart" IS NULL;
