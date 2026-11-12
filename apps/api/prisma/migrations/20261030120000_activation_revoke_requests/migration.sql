-- CreateEnum
CREATE TYPE "public"."ActivationRevokeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "public"."RunningNumberType" ADD VALUE 'ACTIVATION_REVOKE_REQUEST';

-- CreateTable
CREATE TABLE "public"."ActivationRevokeRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "activationId" TEXT NOT NULL,
    "ownerType" "public"."SubscriptionOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "machineCode" TEXT,
    "status" "public"."ActivationRevokeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "reviewRemarks" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivationRevokeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivationRevokeRequest_requestNumber_key" ON "public"."ActivationRevokeRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "ActivationRevokeRequest_status_idx" ON "public"."ActivationRevokeRequest"("status");

-- CreateIndex
CREATE INDEX "ActivationRevokeRequest_ownerId_idx" ON "public"."ActivationRevokeRequest"("ownerId");

-- CreateIndex
CREATE INDEX "ActivationRevokeRequest_activationId_idx" ON "public"."ActivationRevokeRequest"("activationId");

-- AddForeignKey
ALTER TABLE "public"."ActivationRevokeRequest" ADD CONSTRAINT "ActivationRevokeRequest_activationId_fkey" FOREIGN KEY ("activationId") REFERENCES "public"."Activation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

