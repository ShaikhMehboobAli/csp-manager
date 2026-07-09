/*
  Warnings:

  - A unique constraint covering the columns `[planId,billingCycle]` on the table `PlanPricing` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."RunningNumberType" AS ENUM ('SUBSCRIPTION', 'PAYMENT', 'INVOICE');

-- AlterEnum
ALTER TYPE "public"."SubscriptionStatus" ADD VALUE 'PENDING';

-- CreateTable
CREATE TABLE "public"."RunningNumber" (
    "id" TEXT NOT NULL,
    "type" "public"."RunningNumberType" NOT NULL,
    "currentValue" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunningNumber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunningNumber_type_key" ON "public"."RunningNumber"("type");

-- CreateIndex
CREATE UNIQUE INDEX "PlanPricing_planId_billingCycle_key" ON "public"."PlanPricing"("planId", "billingCycle");
