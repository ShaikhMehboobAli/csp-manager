-- AlterTable
ALTER TABLE "public"."Receipt" ADD COLUMN     "machineSessionId" TEXT;

-- CreateIndex
CREATE INDEX "Receipt_machineSessionId_idx" ON "public"."Receipt"("machineSessionId");

-- AddForeignKey
ALTER TABLE "public"."Receipt" ADD CONSTRAINT "Receipt_machineSessionId_fkey" FOREIGN KEY ("machineSessionId") REFERENCES "public"."MachineSession"("machineSessionId") ON DELETE SET NULL ON UPDATE CASCADE;
