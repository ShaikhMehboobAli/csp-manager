/*
  Warnings:

  - You are about to drop the column `bcId` on the `Subscription` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Subscription" DROP CONSTRAINT "Subscription_bcId_fkey";

-- DropIndex
DROP INDEX "public"."Subscription_bcId_idx";

-- AlterTable
ALTER TABLE "public"."Payment" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "receiptUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."Subscription" DROP COLUMN "bcId",
ADD COLUMN     "businessCorrespondentId" TEXT;

-- AddForeignKey
ALTER TABLE "public"."Subscription" ADD CONSTRAINT "Subscription_businessCorrespondentId_fkey" FOREIGN KEY ("businessCorrespondentId") REFERENCES "public"."BusinessCorrespondent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
