-- CreateEnum
CREATE TYPE "CommissionGroup" AS ENUM ('FINANCIAL', 'NON_FINANCIAL', 'ENROLMENT');

-- CreateEnum
CREATE TYPE "CommissionRateType" AS ENUM ('FLAT', 'PERCENT', 'INHERIT');

-- CreateEnum
CREATE TYPE "CommissionScope" AS ENUM ('DEFAULT', 'BC', 'CSP');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "workdayEnd" TEXT,
ADD COLUMN     "workdayStart" TEXT;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "balanceAfter" DECIMAL(14,2),
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bankResponseCode" TEXT,
ADD COLUMN     "bankResponseMessage" TEXT,
ADD COLUMN     "bankTransactionId" TEXT,
ADD COLUMN     "commissionAmount" DECIMAL(12,2),
ADD COLUMN     "commissionRateId" TEXT;

-- AlterTable
ALTER TABLE "ReceiptDailyCount" ADD COLUMN     "commissionAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CommissionService" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transactionCategory" "TransactionCategory" NOT NULL,
    "receiptType" "ReceiptType",
    "group" "CommissionGroup" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRate" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "scope" "CommissionScope" NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "type" "CommissionRateType" NOT NULL,
    "amount" DECIMAL(12,2),
    "percent" DECIMAL(7,4),
    "minAmount" DECIMAL(12,2),
    "maxAmount" DECIMAL(12,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionService_code_key" ON "CommissionService"("code");

-- CreateIndex
CREATE INDEX "CommissionRate_serviceId_scope_scopeId_effectiveFrom_idx" ON "CommissionRate"("serviceId", "scope", "scopeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "CommissionRate_scope_scopeId_idx" ON "CommissionRate"("scope", "scopeId");

-- AddForeignKey
ALTER TABLE "CommissionRate" ADD CONSTRAINT "CommissionRate_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "CommissionService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Services commission is paid on (rates are set by the super admin; none yet = ₹0).
INSERT INTO "CommissionService" ("id", "code", "name", "transactionCategory", "receiptType", "group", "sortOrder", "updatedAt") VALUES
  ('cs_cw',       'CW',       'Cash withdrawal',        'CASH_WITHDRAWAL',   NULL,     'FINANCIAL',     10,  CURRENT_TIMESTAMP),
  ('cs_cd',       'CD',       'Cash deposit',           'CASH_DEPOSIT',      NULL,     'FINANCIAL',     20,  CURRENT_TIMESTAMP),
  ('cs_mt',       'MT',       'Money transfer',         'MONEY_TRANSFER',    NULL,     'FINANCIAL',     30,  CURRENT_TIMESTAMP),
  ('cs_ft',       'FT',       'Fund transfer',          'FUND_TRANSFER',     NULL,     'FINANCIAL',     40,  CURRENT_TIMESTAMP),
  ('cs_matm',     'MATM',     'Micro ATM',              'MICRO_ATM',         NULL,     'FINANCIAL',     50,  CURRENT_TIMESTAMP),
  ('cs_bbps',     'BBPS',     'Bill payment (BBPS)',    'BBPS',              NULL,     'FINANCIAL',     60,  CURRENT_TIMESTAMP),
  ('cs_loan',     'LOAN',     'Loan',                   'LOAN',              NULL,     'FINANCIAL',     70,  CURRENT_TIMESTAMP),
  ('cs_be',       'BE',       'Balance enquiry',        'BALANCE_ENQUIRY',   NULL,     'NON_FINANCIAL', 110, CURRENT_TIMESTAMP),
  ('cs_ms',       'MS',       'Mini statement',         'MINI_STATEMENT',    NULL,     'NON_FINANCIAL', 120, CURRENT_TIMESTAMP),
  ('cs_pb',       'PB',       'Passbook printing',      'PASSBOOK_PRINTING', NULL,     'NON_FINANCIAL', 130, CURRENT_TIMESTAMP),
  ('cs_ao',       'AO',       'Account opening',        'ACCOUNT_OPENING',   NULL,     'ENROLMENT',     210, CURRENT_TIMESTAMP),
  ('cs_pmjjby',   'PMJJBY',   'PMJJBY',                 'SOCIAL_SECURITY',   'PMJJBY', 'ENROLMENT',     220, CURRENT_TIMESTAMP),
  ('cs_pmsby',    'PMSBY',    'PMSBY',                  'SOCIAL_SECURITY',   'PMSBY',  'ENROLMENT',     230, CURRENT_TIMESTAMP),
  ('cs_apy',      'APY',      'APY',                    'SOCIAL_SECURITY',   'APY',    'ENROLMENT',     240, CURRENT_TIMESTAMP),
  ('cs_ss_other', 'SS_OTHER', 'Other social security',  'SOCIAL_SECURITY',   NULL,     'ENROLMENT',     250, CURRENT_TIMESTAMP);
