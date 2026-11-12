-- CreateEnum
CREATE TYPE "CashDueSide" AS ENUM ('CASH_IN_HAND', 'CASH_IN_ACCOUNT', 'OTHER_CASH');

-- AlterTable
ALTER TABLE "AgentCash" ADD COLUMN     "tasksReadAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CashDue" ADD COLUMN     "cashSide" "CashDueSide";

-- AlterTable
ALTER TABLE "CashLedger" ADD COLUMN     "balanceCashDueExtra" DECIMAL(14,2),
ADD COLUMN     "cashDueExtraChange" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CashPool" ADD COLUMN     "cashDueExtra" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MachineIdempotencyKey" (
    "id" TEXT NOT NULL,
    "machineCode" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineIdempotencyKey_createdAt_idx" ON "MachineIdempotencyKey"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MachineIdempotencyKey_machineCode_key_key" ON "MachineIdempotencyKey"("machineCode", "key");
