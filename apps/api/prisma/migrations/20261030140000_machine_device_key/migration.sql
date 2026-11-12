-- AlterTable
ALTER TABLE "public"."Machine" ADD COLUMN     "devicePublicKey" TEXT,
ADD COLUMN     "devicePublicKeyRegisteredAt" TIMESTAMP(3);

