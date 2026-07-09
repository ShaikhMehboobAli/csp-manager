-- CreateEnum
CREATE TYPE "public"."OTPPurpose" AS ENUM ('SIGNUP', 'LOGIN', 'PASSWORD_RESET', 'EMAIL_VERIFICATION', 'PHONE_VERIFICATION');

-- CreateEnum
CREATE TYPE "public"."OTPChannel" AS ENUM ('EMAIL', 'SMS');

-- AlterEnum
ALTER TYPE "public"."AgentType" ADD VALUE 'BC';

-- AlterTable
ALTER TABLE "public"."Activation" ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."Agent" ADD COLUMN     "selfRegistered" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."Communication" ADD COLUMN     "otpId" TEXT;

-- AlterTable
ALTER TABLE "public"."Machine" ADD COLUMN     "watcherEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."Subscription" ADD COLUMN     "graceEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "signupCompleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OTP" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "public"."OTPChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "otpCode" TEXT NOT NULL,
    "purpose" "public"."OTPPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OTP_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "public"."UserSession"("userId");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "public"."UserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "OTP_recipient_idx" ON "public"."OTP"("recipient");

-- CreateIndex
CREATE INDEX "OTP_purpose_idx" ON "public"."OTP"("purpose");

-- CreateIndex
CREATE INDEX "OTP_expiresAt_idx" ON "public"."OTP"("expiresAt");

-- AddForeignKey
ALTER TABLE "public"."UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OTP" ADD CONSTRAINT "OTP_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
