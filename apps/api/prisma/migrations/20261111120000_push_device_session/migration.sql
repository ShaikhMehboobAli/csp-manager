-- AlterTable
ALTER TABLE "NotificationDevice" ADD COLUMN     "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "NotificationDevice_sessionId_idx" ON "NotificationDevice"("sessionId");

-- AddForeignKey
ALTER TABLE "NotificationDevice" ADD CONSTRAINT "NotificationDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

