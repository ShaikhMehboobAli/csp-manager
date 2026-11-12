-- CreateEnum
CREATE TYPE "ReceiptSource" AS ENUM ('AUTOMATION', 'MANUAL');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('android', 'ios');

-- CreateEnum
CREATE TYPE "DiagnosticsStatus" AS ENUM ('OPEN', 'RECEIVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "BcLinkRequestStatus" ADD VALUE 'UNLINKED';

-- AlterEnum
ALTER TYPE "CashLedgerType" ADD VALUE 'RECEIPT_COUNT';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'BC_UNLINKED';

-- AlterEnum
ALTER TYPE "RunningNumberType" ADD VALUE 'DIAGNOSTICS_REQUEST';

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "sbiUserId" TEXT;

-- AlterTable
ALTER TABLE "BcLinkRequest" ADD COLUMN     "unlinkReason" TEXT,
ADD COLUMN     "unlinkedAt" TIMESTAMP(3),
ADD COLUMN     "unlinkedByUserId" TEXT;

-- AlterTable
ALTER TABLE "CashDayClose" ADD COLUMN     "accountDifference" DECIMAL(14,2),
ADD COLUMN     "countedCashInAccount" DECIMAL(14,2),
ADD COLUMN     "systemCashInAccount" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "denominationCountedAt" TIMESTAMP(3),
ADD COLUMN     "denominationPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" "ReceiptSource";

-- CreateTable
CREATE TABLE "NotificationDevice" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "cash" BOOLEAN NOT NULL DEFAULT true,
    "settlements" BOOLEAN NOT NULL DEFAULT true,
    "machines" BOOLEAN NOT NULL DEFAULT true,
    "requests" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ActivationEmail" (
    "id" TEXT NOT NULL,
    "activationId" TEXT NOT NULL,
    "sentTo" TEXT NOT NULL,
    "sentByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivationEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticsRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "machineCode" TEXT NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "status" "DiagnosticsStatus" NOT NULL DEFAULT 'OPEN',
    "requestedByUserId" TEXT NOT NULL,
    "requestedByRole" "UserRole" NOT NULL,
    "note" TEXT,
    "partsExpected" INTEGER,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticsRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticsPart" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "part" INTEGER NOT NULL,
    "parts" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "appVersion" TEXT,
    "size" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticsPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDevice_token_key" ON "NotificationDevice"("token");

-- CreateIndex
CREATE INDEX "NotificationDevice_userId_idx" ON "NotificationDevice"("userId");

-- CreateIndex
CREATE INDEX "ActivationEmail_activationId_createdAt_idx" ON "ActivationEmail"("activationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticsRequest_requestNumber_key" ON "DiagnosticsRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "DiagnosticsRequest_machineId_status_idx" ON "DiagnosticsRequest"("machineId", "status");

-- CreateIndex
CREATE INDEX "DiagnosticsRequest_createdAt_idx" ON "DiagnosticsRequest"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticsPart_requestId_part_key" ON "DiagnosticsPart"("requestId", "part");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_sbiUserId_key" ON "Agent"("sbiUserId");

-- CreateIndex
CREATE INDEX "Receipt_agentId_denominationPending_idx" ON "Receipt"("agentId", "denominationPending");

-- AddForeignKey
ALTER TABLE "DiagnosticsPart" ADD CONSTRAINT "DiagnosticsPart_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DiagnosticsRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

