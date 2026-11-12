-- AlterTable
ALTER TABLE "SubscriptionMandate" ADD COLUMN     "maxAmount" DECIMAL(12,2),
ADD COLUMN     "providerRegistrationId" TEXT;

-- CreateTable
CREATE TABLE "RazorpayWebhookEvent" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RazorpayWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RazorpayWebhookEvent_entityId_idx" ON "RazorpayWebhookEvent"("entityId");

-- CreateIndex
CREATE INDEX "RazorpayWebhookEvent_createdAt_idx" ON "RazorpayWebhookEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionMandate_providerRegistrationId_key" ON "SubscriptionMandate"("providerRegistrationId");

