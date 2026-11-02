-- CreateEnum
CREATE TYPE "CashSettlementDirection" AS ENUM ('ACCOUNT_TO_HAND', 'HAND_TO_ACCOUNT');

-- CreateEnum
CREATE TYPE "CashSettlementStep" AS ENUM ('TO_BANK', 'FROM_BANK');

-- CreateEnum
CREATE TYPE "CashSettlementStatus" AS ENUM ('PENDING', 'APPROVED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CashLedgerType" ADD VALUE 'SETTLEMENT_TO_BANK';
ALTER TYPE "CashLedgerType" ADD VALUE 'SETTLEMENT_FROM_BANK';
ALTER TYPE "CashLedgerType" ADD VALUE 'SETTLEMENT_CANCELLED';

-- AlterTable
ALTER TABLE "CashLedger" ADD COLUMN     "balanceCashInTransit" DECIMAL(14,2),
ADD COLUMN     "cashInTransitChange" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "settlementId" TEXT;

-- AlterTable
ALTER TABLE "CashPool" ADD COLUMN     "cashInTransit" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CashSettlement" (
    "id" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "direction" "CashSettlementDirection" NOT NULL,
    "step" "CashSettlementStep" NOT NULL,
    "status" "CashSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2) NOT NULL,
    "settledAmount" DECIMAL(14,2),
    "drawer" JSONB,
    "parentId" TEXT,
    "remarks" TEXT,
    "requestedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashSettlement_parentId_key" ON "CashSettlement"("parentId");

-- CreateIndex
CREATE INDEX "CashSettlement_cspAgentId_status_idx" ON "CashSettlement"("cspAgentId", "status");

-- CreateIndex
CREATE INDEX "CashSettlement_agentId_status_createdAt_idx" ON "CashSettlement"("agentId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "CashSettlement" ADD CONSTRAINT "CashSettlement_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSettlement" ADD CONSTRAINT "CashSettlement_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CashSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

