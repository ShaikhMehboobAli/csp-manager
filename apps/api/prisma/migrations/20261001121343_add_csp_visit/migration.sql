-- CreateTable
CREATE TABLE "public"."CspVisit" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "cspAgentId" TEXT NOT NULL,
    "visitedByAgentId" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "photoUrl" TEXT,
    "remarks" TEXT,
    "points" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CspVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CspVisitCustomerReview" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "customerName" TEXT,
    "customerAccount" TEXT,
    "review" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CspVisitCustomerReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CspVisit_visitId_key" ON "public"."CspVisit"("visitId");

-- CreateIndex
CREATE INDEX "CspVisit_cspAgentId_idx" ON "public"."CspVisit"("cspAgentId");

-- CreateIndex
CREATE INDEX "CspVisit_visitedByAgentId_idx" ON "public"."CspVisit"("visitedByAgentId");

-- CreateIndex
CREATE INDEX "CspVisit_visitDate_idx" ON "public"."CspVisit"("visitDate");

-- CreateIndex
CREATE INDEX "CspVisit_cspAgentId_visitDate_idx" ON "public"."CspVisit"("cspAgentId", "visitDate");

-- CreateIndex
CREATE INDEX "CspVisitCustomerReview_visitId_idx" ON "public"."CspVisitCustomerReview"("visitId");

-- AddForeignKey
ALTER TABLE "public"."CspVisit" ADD CONSTRAINT "CspVisit_cspAgentId_fkey" FOREIGN KEY ("cspAgentId") REFERENCES "public"."Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CspVisit" ADD CONSTRAINT "CspVisit_visitedByAgentId_fkey" FOREIGN KEY ("visitedByAgentId") REFERENCES "public"."Agent"("agentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CspVisitCustomerReview" ADD CONSTRAINT "CspVisitCustomerReview_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "public"."CspVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
