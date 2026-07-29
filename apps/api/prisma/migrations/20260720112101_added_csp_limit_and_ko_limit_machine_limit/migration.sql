/*
  Warnings:

  - You are about to drop the column `code` on the `BusinessCorrespondent` table. All the data in the column will be lost.
  - You are about to drop the column `agentId` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `agentId` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `bcId` on the `Subscription` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[bcId]` on the table `BusinessCorrespondent` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `activationPasswordHash` to the `Activation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `bcId` to the `BusinessCorrespondent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerId` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerType` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cspLimit` to the `Subscription` table without a default value. This is not possible if the table is not empty.
  - Added the required column `koLimit` to the `Subscription` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerId` to the `Subscription` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerType` to the `Subscription` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."RunningNumberType" ADD VALUE 'MACHINE';
ALTER TYPE "public"."RunningNumberType" ADD VALUE 'ACTIVATION';

-- DropForeignKey
ALTER TABLE "public"."Agent" DROP CONSTRAINT "Agent_bcId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Agent" DROP CONSTRAINT "Agent_parentAgentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Machine" DROP CONSTRAINT "Machine_agentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Payment" DROP CONSTRAINT "Payment_agentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Subscription" DROP CONSTRAINT "Subscription_agentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Subscription" DROP CONSTRAINT "Subscription_bcId_fkey";

-- DropIndex
DROP INDEX "public"."BusinessCorrespondent_code_key";

-- DropIndex
DROP INDEX "public"."Subscription_agentId_idx";

-- AlterTable
ALTER TABLE "public"."Activation" ADD COLUMN     "activationPasswordHash" TEXT NOT NULL,
ADD COLUMN     "assignedAgentId" TEXT,
ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedByOwnerId" TEXT,
ADD COLUMN     "assignedByOwnerType" "public"."SubscriptionOwnerType",
ADD COLUMN     "passwordGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "passwordRegeneratedAt" TIMESTAMP(3),
ALTER COLUMN "machineId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."Agent" ADD COLUMN     "cashLimit" DECIMAL(18,2),
ADD COLUMN     "linkedAt" TIMESTAMP(3),
ADD COLUMN     "openingCash" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "public"."BusinessCorrespondent" DROP COLUMN "code",
ADD COLUMN     "bcId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."Payment" DROP COLUMN "agentId",
ADD COLUMN     "bcId" TEXT,
ADD COLUMN     "ownerId" TEXT NOT NULL,
ADD COLUMN     "ownerType" "public"."SubscriptionOwnerType" NOT NULL;

-- AlterTable
ALTER TABLE "public"."Subscription" DROP COLUMN "agentId",
DROP COLUMN "bcId",
ADD COLUMN     "cspLimit" INTEGER NOT NULL,
ADD COLUMN     "koLimit" INTEGER NOT NULL,
ADD COLUMN     "ownerId" TEXT NOT NULL,
ADD COLUMN     "ownerType" "public"."SubscriptionOwnerType" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCorrespondent_bcId_key" ON "public"."BusinessCorrespondent"("bcId");

-- AddForeignKey
ALTER TABLE "public"."Agent" ADD CONSTRAINT "Agent_bcId_fkey" FOREIGN KEY ("bcId") REFERENCES "public"."BusinessCorrespondent"("bcId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Agent" ADD CONSTRAINT "Agent_parentAgentId_fkey" FOREIGN KEY ("parentAgentId") REFERENCES "public"."Agent"("agentId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Machine" ADD CONSTRAINT "Machine_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("agentId") ON DELETE SET NULL ON UPDATE CASCADE;
