-- AlterEnum
ALTER TYPE "public"."ReceiptType" ADD VALUE 'PASSBOOK';

-- AlterEnum
ALTER TYPE "public"."TransactionCategory" ADD VALUE 'PASSBOOK_PRINTING';

-- DropForeignKey
ALTER TABLE "public"."FloatLedger" DROP CONSTRAINT "FloatLedger_receiptId_fkey";

-- DropIndex
DROP INDEX "public"."FloatLedger_receiptId_idx";

-- DropIndex
DROP INDEX "public"."Receipt_receiptId_key";

-- AlterTable: link ledger rows to Receipt.id, carrying existing links over
ALTER TABLE "public"."FloatLedger" ADD COLUMN     "receiptRecordId" TEXT;

UPDATE "public"."FloatLedger" AS fl
SET "receiptRecordId" = r."id"
FROM "public"."Receipt" AS r
WHERE fl."receiptId" = r."receiptId";

ALTER TABLE "public"."FloatLedger" DROP COLUMN "receiptId";

-- AlterTable
ALTER TABLE "public"."Machine" ADD COLUMN     "desktopControls" JSONB;

-- AlterTable
ALTER TABLE "public"."Payment" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateTable
CREATE TABLE "public"."AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "FloatLedger_receiptRecordId_idx" ON "public"."FloatLedger"("receiptRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_gatewayTransactionId_key" ON "public"."Payment"("gatewayTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_ownerId_idempotencyKey_key" ON "public"."Payment"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_agentId_receiptId_key" ON "public"."Receipt"("agentId", "receiptId");

-- AddForeignKey
ALTER TABLE "public"."FloatLedger" ADD CONSTRAINT "FloatLedger_receiptRecordId_fkey" FOREIGN KEY ("receiptRecordId") REFERENCES "public"."Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

