-- CreateEnum
CREATE TYPE "public"."BcLinkRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "public"."RunningNumberType" ADD VALUE 'BC_LINK_REQUEST';

-- AlterTable
ALTER TABLE "public"."Agent" ADD COLUMN     "bcLinkedByRequest" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."BcLinkRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "bcId" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "status" "public"."BcLinkRequestStatus" NOT NULL DEFAULT 'PENDING',
    "isConflict" BOOLEAN NOT NULL DEFAULT false,
    "currentBcId" TEXT,
    "remarks" TEXT,
    "reviewRemarks" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BcLinkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BcLinkRequest_requestNumber_key" ON "public"."BcLinkRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "BcLinkRequest_status_idx" ON "public"."BcLinkRequest"("status");

-- CreateIndex
CREATE INDEX "BcLinkRequest_bcId_idx" ON "public"."BcLinkRequest"("bcId");

-- CreateIndex
CREATE INDEX "BcLinkRequest_cspAgentId_idx" ON "public"."BcLinkRequest"("cspAgentId");

-- AddForeignKey
ALTER TABLE "public"."BcLinkRequest" ADD CONSTRAINT "BcLinkRequest_bcId_fkey" FOREIGN KEY ("bcId") REFERENCES "public"."BusinessCorrespondent"("bcId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BcLinkRequest" ADD CONSTRAINT "BcLinkRequest_cspAgentId_fkey" FOREIGN KEY ("cspAgentId") REFERENCES "public"."Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;
