-- CreateEnum
CREATE TYPE "ReceiptReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "CommissionRateType" ADD VALUE 'SLAB';

-- AlterTable
ALTER TABLE "CommissionRate" ADD COLUMN     "slabs" JSONB;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "slipKey" TEXT,
ADD COLUMN     "slipUploadedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "statusReason" TEXT;

-- CreateTable
CREATE TABLE "ReceiptReport" (
    "id" TEXT NOT NULL,
    "receiptRowId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "ownerAgentId" TEXT NOT NULL,
    "reportedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" "ReceiptReportStatus" NOT NULL DEFAULT 'OPEN',
    "receiptSnapshot" JSONB NOT NULL,
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceiptReport_status_createdAt_idx" ON "ReceiptReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReceiptReport_ownerAgentId_createdAt_idx" ON "ReceiptReport"("ownerAgentId", "createdAt");

-- CreateIndex
CREATE INDEX "ReceiptReport_receiptRowId_idx" ON "ReceiptReport"("receiptRowId");

