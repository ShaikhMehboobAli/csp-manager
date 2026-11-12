-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'MACHINE_OFFLINE';
ALTER TYPE "NotificationKind" ADD VALUE 'CASH_DAY_NOT_CLOSED';

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "offlineAlertAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CashDayReminder" (
    "id" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashDayReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashDayReminder_date_idx" ON "CashDayReminder"("date");

-- CreateIndex
CREATE UNIQUE INDEX "CashDayReminder_agentId_date_key" ON "CashDayReminder"("agentId", "date");

