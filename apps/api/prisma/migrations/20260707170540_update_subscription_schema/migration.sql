/*
  Warnings:

  - You are about to drop the column `businessCorrespondentId` on the `Subscription` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."SubscriptionCreatedSource" AS ENUM ('SELF', 'ADMIN', 'MIGRATION');

-- DropForeignKey
ALTER TABLE "public"."Subscription" DROP CONSTRAINT "Subscription_businessCorrespondentId_fkey";

-- AlterTable
ALTER TABLE "public"."Subscription" DROP COLUMN "businessCorrespondentId",
ADD COLUMN     "bcId" TEXT,
ADD COLUMN     "createdSource" "public"."SubscriptionCreatedSource" NOT NULL DEFAULT 'SELF';

-- AddForeignKey
ALTER TABLE "public"."Subscription" ADD CONSTRAINT "Subscription_bcId_fkey" FOREIGN KEY ("bcId") REFERENCES "public"."BusinessCorrespondent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
