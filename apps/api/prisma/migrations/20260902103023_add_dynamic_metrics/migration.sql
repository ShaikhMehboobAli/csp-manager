-- CreateEnum
CREATE TYPE "public"."MetricCategory" AS ENUM ('SOCIAL_SECURITY', 'TRANSACTION', 'VISIT', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."MetricSource" AS ENUM ('RECEIPT', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."MetricInputType" AS ENUM ('COUNT', 'NUMBER', 'BOOLEAN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."ReceiptType" ADD VALUE 'APY';
ALTER TYPE "public"."ReceiptType" ADD VALUE 'PMJJBY';
ALTER TYPE "public"."ReceiptType" ADD VALUE 'PMSBY';
ALTER TYPE "public"."ReceiptType" ADD VALUE 'MUDRA_LOAN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."TransactionCategory" ADD VALUE 'SOCIAL_SECURITY';
ALTER TYPE "public"."TransactionCategory" ADD VALUE 'LOAN';

-- CreateTable
CREATE TABLE "public"."MetricDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "public"."MetricCategory" NOT NULL,
    "source" "public"."MetricSource" NOT NULL,
    "inputType" "public"."MetricInputType" NOT NULL DEFAULT 'COUNT',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MetricValue" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetricDefinition_code_key" ON "public"."MetricDefinition"("code");

-- CreateIndex
CREATE INDEX "MetricDefinition_category_idx" ON "public"."MetricDefinition"("category");

-- CreateIndex
CREATE INDEX "MetricDefinition_source_idx" ON "public"."MetricDefinition"("source");

-- CreateIndex
CREATE INDEX "MetricDefinition_isActive_idx" ON "public"."MetricDefinition"("isActive");

-- CreateIndex
CREATE INDEX "MetricValue_metricId_idx" ON "public"."MetricValue"("metricId");

-- CreateIndex
CREATE INDEX "MetricValue_agentId_idx" ON "public"."MetricValue"("agentId");

-- CreateIndex
CREATE INDEX "MetricValue_date_idx" ON "public"."MetricValue"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MetricValue_metricId_agentId_date_key" ON "public"."MetricValue"("metricId", "agentId", "date");

-- AddForeignKey
ALTER TABLE "public"."MetricValue" ADD CONSTRAINT "MetricValue_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "public"."MetricDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MetricValue" ADD CONSTRAINT "MetricValue_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;
