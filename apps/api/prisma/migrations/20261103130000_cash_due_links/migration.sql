-- AlterTable
ALTER TABLE "CashDue" ADD COLUMN     "drawer" JSONB;

-- AlterTable
ALTER TABLE "CashLedger" ADD COLUMN     "dueId" TEXT;
