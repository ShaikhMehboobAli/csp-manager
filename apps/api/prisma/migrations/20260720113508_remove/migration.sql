/*
  Warnings:

  - You are about to drop the column `cspLimit` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `koLimit` on the `Subscription` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Subscription" DROP COLUMN "cspLimit",
DROP COLUMN "koLimit";
