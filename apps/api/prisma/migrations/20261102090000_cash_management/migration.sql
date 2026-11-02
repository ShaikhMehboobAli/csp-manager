-- CreateEnum
CREATE TYPE "CashLedgerType" AS ENUM ('OPENING', 'AGENT_ADDED', 'RECEIPT', 'RECEIPT_NOT_APPLIED', 'SETTLEMENT', 'ADJUSTMENT', 'REQUEST_APPROVED');

-- CreateEnum
CREATE TYPE "CashRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CashActorType" AS ENUM ('USER', 'MACHINE', 'SYSTEM');

-- CreateTable
CREATE TABLE "CashPool" (
    "cspAgentId" TEXT NOT NULL,
    "cashLimit" DECIMAL(14,2) NOT NULL,
    "cashInAccount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashPool_pkey" PRIMARY KEY ("cspAgentId")
);

-- CreateTable
CREATE TABLE "AgentCash" (
    "agentId" TEXT NOT NULL,
    "cashInHand" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes500" INTEGER NOT NULL DEFAULT 0,
    "notes200" INTEGER NOT NULL DEFAULT 0,
    "notes100" INTEGER NOT NULL DEFAULT 0,
    "notes50" INTEGER NOT NULL DEFAULT 0,
    "notes20" INTEGER NOT NULL DEFAULT 0,
    "notes10" INTEGER NOT NULL DEFAULT 0,
    "notes5" INTEGER NOT NULL DEFAULT 0,
    "coins20" INTEGER NOT NULL DEFAULT 0,
    "coins10" INTEGER NOT NULL DEFAULT 0,
    "coins5" INTEGER NOT NULL DEFAULT 0,
    "coins2" INTEGER NOT NULL DEFAULT 0,
    "coins1" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCash_pkey" PRIMARY KEY ("agentId")
);

-- CreateTable
CREATE TABLE "CashLedger" (
    "id" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "agentId" TEXT,
    "type" "CashLedgerType" NOT NULL,
    "reason" TEXT,
    "transactionCategory" "TransactionCategory",
    "amount" DECIMAL(14,2),
    "cashInHandChange" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashInAccountChange" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashLimitChange" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balanceCashInHand" DECIMAL(14,2),
    "balanceCashInAccount" DECIMAL(14,2),
    "balanceCashLimit" DECIMAL(14,2),
    "drawerChange" JSONB,
    "receiptRecordId" TEXT,
    "requestId" TEXT,
    "idempotencyKey" TEXT,
    "actorType" "CashActorType" NOT NULL,
    "actorId" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRequest" (
    "id" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "requestedCashInHand" DECIMAL(14,2) NOT NULL,
    "systemCashInHand" DECIMAL(14,2) NOT NULL,
    "requestedDrawer" JSONB,
    "reason" TEXT NOT NULL,
    "status" "CashRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewRemarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashLedger_cspAgentId_createdAt_idx" ON "CashLedger"("cspAgentId", "createdAt");

-- CreateIndex
CREATE INDEX "CashLedger_agentId_createdAt_idx" ON "CashLedger"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "CashLedger_receiptRecordId_idx" ON "CashLedger"("receiptRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "CashLedger_cspAgentId_idempotencyKey_key" ON "CashLedger"("cspAgentId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CashRequest_cspAgentId_status_idx" ON "CashRequest"("cspAgentId", "status");

-- CreateIndex
CREATE INDEX "CashRequest_agentId_status_idx" ON "CashRequest"("agentId", "status");

-- AddForeignKey
ALTER TABLE "CashPool" ADD CONSTRAINT "CashPool_cspAgentId_fkey" FOREIGN KEY ("cspAgentId") REFERENCES "Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCash" ADD CONSTRAINT "AgentCash_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashLedger" ADD CONSTRAINT "CashLedger_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashLedger" ADD CONSTRAINT "CashLedger_receiptRecordId_fkey" FOREIGN KEY ("receiptRecordId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRequest" ADD CONSTRAINT "CashRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

