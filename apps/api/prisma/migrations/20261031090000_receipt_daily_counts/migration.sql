-- CreateTable
CREATE TABLE "ReceiptDailyCount" (
    "date" DATE NOT NULL,
    "agentId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "receiptType" "ReceiptType" NOT NULL,
    "transactionCategory" "TransactionCategory" NOT NULL,
    "transactionType" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "firstTransactionAt" TIMESTAMP(3) NOT NULL,
    "lastTransactionAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptDailyCount_pkey" PRIMARY KEY ("date","agentId","machineId","receiptType","transactionCategory","transactionType","status")
);

-- CreateIndex
CREATE INDEX "ReceiptDailyCount_agentId_date_idx" ON "ReceiptDailyCount"("agentId", "date");

-- CreateIndex
CREATE INDEX "ReceiptDailyCount_machineId_date_idx" ON "ReceiptDailyCount"("machineId", "date");

-- AddForeignKey
ALTER TABLE "ReceiptDailyCount" ADD CONSTRAINT "ReceiptDailyCount_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptDailyCount" ADD CONSTRAINT "ReceiptDailyCount_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill from the receipts kept so far. "transactionAt" is stored as UTC;
-- the day is the IST calendar day.
INSERT INTO "ReceiptDailyCount" (
    "date", "agentId", "machineId", "receiptType", "transactionCategory",
    "transactionType", "status", "count", "amount",
    "firstTransactionAt", "lastTransactionAt", "updatedAt"
)
SELECT
    ("transactionAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date,
    "agentId", "machineId", "receiptType", "transactionCategory",
    "transactionType", "status",
    COUNT(*)::int,
    COALESCE(SUM("amount"), 0),
    MIN("transactionAt"),
    MAX("transactionAt"),
    CURRENT_TIMESTAMP
FROM "Receipt"
WHERE "transactionAt" IS NOT NULL AND "status" IS NOT NULL
GROUP BY 1, "agentId", "machineId", "receiptType", "transactionCategory",
    "transactionType", "status";
