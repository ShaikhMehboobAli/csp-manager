/*
  Warnings:

  - The values [INACTIVE] on the enum `UserStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `channel` on the `OTP` table. All the data in the column will be lost.
  - You are about to drop the column `recipient` on the `OTP` table. All the data in the column will be lost.
  - You are about to drop the column `bcId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `deletedAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `deletedByUserId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `failedLoginAttempts` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `isDeleted` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `lockedUntil` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[agentId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Made the column `userId` on table `OTP` required. This step will fail if there are existing NULL values in that column.
  - Changed the type of `purpose` on the `OTP` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Made the column `agentId` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "public"."OtpPurpose" AS ENUM ('SIGNUP', 'LOGIN', 'FORGOT_PASSWORD', 'EMAIL_VERIFICATION', 'PHONE_VERIFICATION');

-- AlterEnum
BEGIN;
CREATE TYPE "public"."UserStatus_new" AS ENUM ('PENDING', 'ACTIVE', 'BLOCKED', 'SUSPENDED');
ALTER TABLE "public"."User" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."User" ALTER COLUMN "status" TYPE "public"."UserStatus_new" USING ("status"::text::"public"."UserStatus_new");
ALTER TYPE "public"."UserStatus" RENAME TO "UserStatus_old";
ALTER TYPE "public"."UserStatus_new" RENAME TO "UserStatus";
DROP TYPE "public"."UserStatus_old";
ALTER TABLE "public"."User" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."OTP" DROP CONSTRAINT "OTP_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."User" DROP CONSTRAINT "User_agentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."User" DROP CONSTRAINT "User_bcId_fkey";

-- DropIndex
DROP INDEX "public"."OTP_expiresAt_idx";

-- DropIndex
DROP INDEX "public"."OTP_recipient_idx";

-- DropIndex
DROP INDEX "public"."User_bcId_idx";

-- AlterTable
ALTER TABLE "public"."OTP" DROP COLUMN "channel",
DROP COLUMN "recipient",
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT,
ALTER COLUMN "userId" SET NOT NULL,
DROP COLUMN "purpose",
ADD COLUMN     "purpose" "public"."OtpPurpose" NOT NULL;

-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "bcId",
DROP COLUMN "deletedAt",
DROP COLUMN "deletedByUserId",
DROP COLUMN "failedLoginAttempts",
DROP COLUMN "isDeleted",
DROP COLUMN "lockedUntil",
DROP COLUMN "name",
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ALTER COLUMN "agentId" SET NOT NULL;

-- DropEnum
DROP TYPE "public"."OTPPurpose";

-- CreateIndex
CREATE INDEX "OTP_userId_idx" ON "public"."OTP"("userId");

-- CreateIndex
CREATE INDEX "OTP_purpose_idx" ON "public"."OTP"("purpose");

-- CreateIndex
CREATE UNIQUE INDEX "User_agentId_key" ON "public"."User"("agentId");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OTP" ADD CONSTRAINT "OTP_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
