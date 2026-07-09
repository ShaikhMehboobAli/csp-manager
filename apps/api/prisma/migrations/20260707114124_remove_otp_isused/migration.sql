/*
  Warnings:

  - You are about to drop the column `isUsed` on the `Otp` table. All the data in the column will be lost.
  - You are about to drop the column `verifiedAt` on the `Otp` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Otp" DROP COLUMN "isUsed",
DROP COLUMN "verifiedAt";
