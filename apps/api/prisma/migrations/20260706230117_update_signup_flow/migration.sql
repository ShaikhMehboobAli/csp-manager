-- CreateEnum
CREATE TYPE "public"."ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "public"."Agent" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "createdByAgentId" TEXT,
ADD COLUMN     "isProfileCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedBy" TEXT,
ALTER COLUMN "bcId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."AgentFloat" ADD COLUMN     "approvalStatus" "public"."ApprovalStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "public"."Machine" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "public"."Receipt" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "public"."Subscription" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "updatedBy" TEXT;
