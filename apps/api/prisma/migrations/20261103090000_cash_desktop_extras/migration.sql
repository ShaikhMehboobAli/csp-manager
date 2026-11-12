-- CreateEnum
CREATE TYPE "CashLabelDirection" AS ENUM ('IN', 'OUT', 'BOTH');

-- CreateEnum
CREATE TYPE "CashFlowDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "CashDueKind" AS ENUM ('TO_COLLECT', 'TO_GIVE');

-- CreateEnum
CREATE TYPE "CashDueSource" AS ENUM ('RECEIPT', 'CUSTOM', 'MANUAL');

-- CreateEnum
CREATE TYPE "CashDueStatus" AS ENUM ('OPEN', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CashTaskCreator" AS ENUM ('KO', 'CSP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CashLedgerType" ADD VALUE 'CUSTOM';
ALTER TYPE "CashLedgerType" ADD VALUE 'DUE_CREATED';
ALTER TYPE "CashLedgerType" ADD VALUE 'DUE_SETTLED';
ALTER TYPE "CashLedgerType" ADD VALUE 'DUE_CANCELLED';
ALTER TYPE "CashLedgerType" ADD VALUE 'EXCHANGE';
ALTER TYPE "CashLedgerType" ADD VALUE 'DAY_CLOSE';

-- AlterTable
ALTER TABLE "CashLedger" ADD COLUMN     "balanceCashOther" DECIMAL(14,2),
ADD COLUMN     "cashOtherChange" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CashPool" ADD COLUMN     "cashOther" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CashLabel" (
    "id" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "CashLabelDirection" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashCustomTransaction" (
    "id" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "labelName" TEXT NOT NULL,
    "direction" "CashFlowDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidNow" DECIMAL(14,2) NOT NULL,
    "drawer" JSONB,
    "note" TEXT,
    "machineCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashCustomTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDue" (
    "id" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" "CashDueKind" NOT NULL,
    "source" "CashDueSource" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "originalAmount" DECIMAL(14,2) NOT NULL,
    "receiptRecordId" TEXT,
    "receiptId" TEXT,
    "customTransactionId" TEXT,
    "label" TEXT,
    "note" TEXT,
    "status" "CashDueStatus" NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "CashDue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashExchange" (
    "id" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taken" JSONB NOT NULL,
    "given" JSONB NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "machineCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashExchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDayClose" (
    "id" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "systemCashInHand" DECIMAL(14,2) NOT NULL,
    "systemDrawer" JSONB NOT NULL,
    "countedCashInHand" DECIMAL(14,2) NOT NULL,
    "countedDrawer" JSONB NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "machineCode" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashDayClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashTask" (
    "id" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueAt" TIMESTAMP(3),
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "createdBy" "CashTaskCreator" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashLabel_cspAgentId_name_key" ON "CashLabel"("cspAgentId", "name");

-- CreateIndex
CREATE INDEX "CashCustomTransaction_agentId_createdAt_idx" ON "CashCustomTransaction"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "CashDue_agentId_status_idx" ON "CashDue"("agentId", "status");

-- CreateIndex
CREATE INDEX "CashDue_cspAgentId_status_idx" ON "CashDue"("cspAgentId", "status");

-- CreateIndex
CREATE INDEX "CashExchange_agentId_createdAt_idx" ON "CashExchange"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "CashDayClose_cspAgentId_date_idx" ON "CashDayClose"("cspAgentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CashDayClose_agentId_date_key" ON "CashDayClose"("agentId", "date");

-- CreateIndex
CREATE INDEX "CashTask_agentId_done_idx" ON "CashTask"("agentId", "done");

-- CreateIndex
CREATE INDEX "CashTask_cspAgentId_idx" ON "CashTask"("cspAgentId");

-- AddForeignKey
ALTER TABLE "CashDue" ADD CONSTRAINT "CashDue_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDayClose" ADD CONSTRAINT "CashDayClose_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTask" ADD CONSTRAINT "CashTask_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;
