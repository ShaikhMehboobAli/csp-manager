-- CreateEnum
CREATE TYPE "public"."MachineSessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- AlterEnum
ALTER TYPE "public"."RunningNumberType" ADD VALUE 'MACHINE_SESSION';

-- AlterEnum
ALTER TYPE "public"."SessionEndReason" ADD VALUE 'HEARTBEAT_TIMEOUT';

-- AlterTable
ALTER TABLE "public"."MachineSession" ADD COLUMN     "status" "public"."MachineSessionStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "MachineSession_machineId_status_idx" ON "public"."MachineSession"("machineId", "status");
