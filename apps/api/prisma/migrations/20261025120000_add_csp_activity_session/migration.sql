-- CreateEnum
CREATE TYPE "public"."ActivityEndReason" AS ENUM ('LOGOUT', 'AUTO_LOGOUT', 'APP_CLOSE', 'HEARTBEAT_TIMEOUT', 'REPLACED');

-- AlterEnum
ALTER TYPE "public"."RunningNumberType" ADD VALUE 'CSP_ACTIVITY_SESSION';

-- CreateTable
CREATE TABLE "public"."CspActivitySession" (
    "id" TEXT NOT NULL,
    "activitySessionId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" "public"."MachineSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "endedReason" "public"."ActivityEndReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CspActivitySession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CspActivitySession_activitySessionId_key" ON "public"."CspActivitySession"("activitySessionId");

-- CreateIndex
CREATE INDEX "CspActivitySession_machineId_status_idx" ON "public"."CspActivitySession"("machineId", "status");

-- CreateIndex
CREATE INDEX "CspActivitySession_agentId_startedAt_idx" ON "public"."CspActivitySession"("agentId", "startedAt");

-- CreateIndex
CREATE INDEX "CspActivitySession_status_lastHeartbeatAt_idx" ON "public"."CspActivitySession"("status", "lastHeartbeatAt");

-- AddForeignKey
ALTER TABLE "public"."CspActivitySession" ADD CONSTRAINT "CspActivitySession_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "public"."Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CspActivitySession" ADD CONSTRAINT "CspActivitySession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

