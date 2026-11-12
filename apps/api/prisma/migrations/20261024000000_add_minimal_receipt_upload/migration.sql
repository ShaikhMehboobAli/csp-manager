-- AlterEnum
ALTER TYPE "public"."ReceiptType" ADD VALUE 'ACCOUNT';
ALTER TYPE "public"."ReceiptType" ADD VALUE 'CARD';

-- AlterEnum
ALTER TYPE "public"."TransactionCategory" ADD VALUE 'MONEY_TRANSFER';
ALTER TYPE "public"."TransactionCategory" ADD VALUE 'FUND_TRANSFER';

-- AlterTable
ALTER TABLE "public"."Receipt"
  ALTER COLUMN "status" DROP NOT NULL,
  ALTER COLUMN "transactionAt" DROP NOT NULL,
  ALTER COLUMN "amount" DROP NOT NULL,
  ADD COLUMN "count" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "public"."ReceiptCashDenomination" (
    "id" TEXT NOT NULL,
    "receiptRecordId" TEXT NOT NULL,
    "notes500" INTEGER NOT NULL DEFAULT 0,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptCashDenomination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptCashDenomination_receiptRecordId_key" ON "public"."ReceiptCashDenomination"("receiptRecordId");

-- AddForeignKey
ALTER TABLE "public"."ReceiptCashDenomination" ADD CONSTRAINT "ReceiptCashDenomination_receiptRecordId_fkey" FOREIGN KEY ("receiptRecordId") REFERENCES "public"."Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
