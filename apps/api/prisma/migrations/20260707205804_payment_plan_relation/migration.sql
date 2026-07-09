/*
  Warnings:

  - Added the required column `billingCycle` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `planId` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Payment" ADD COLUMN     "billingCycle" "public"."BillingCycle" NOT NULL,
ADD COLUMN     "planId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
