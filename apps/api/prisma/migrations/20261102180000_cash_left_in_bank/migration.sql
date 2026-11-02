-- AlterTable
ALTER TABLE "CashLedger" ADD COLUMN     "balanceCashLeftInBank" DECIMAL(14,2),
ADD COLUMN     "cashLeftInBankChange" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CashPool" ADD COLUMN     "cashLeftInBank" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- One open settlement step per agent at a time.
CREATE UNIQUE INDEX "CashSettlement_one_open_per_agent" ON "CashSettlement"("agentId") WHERE "status" = 'PENDING';
