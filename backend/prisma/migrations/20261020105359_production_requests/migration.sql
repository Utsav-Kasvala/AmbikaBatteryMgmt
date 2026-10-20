-- CreateEnum
CREATE TYPE "ProductionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProductionRequestEventType" AS ENUM ('SUBMITTED', 'EDITED', 'DELETED', 'APPROVED', 'REJECTED', 'RESUBMITTED');

-- CreateTable
CREATE TABLE "production_requests" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "batteryTypeId" INTEGER NOT NULL,
    "recipeVersionId" INTEGER NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ProductionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "recipeSnapshot" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedById" INTEGER,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" INTEGER,
    "rejectionReason" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedById" INTEGER,
    "reversalReason" TEXT,

    CONSTRAINT "production_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_request_events" (
    "id" SERIAL NOT NULL,
    "productionRequestId" INTEGER NOT NULL,
    "eventType" "ProductionRequestEventType" NOT NULL,
    "actorId" INTEGER NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_requests_companyId_idx" ON "production_requests"("companyId");

-- CreateIndex
CREATE INDEX "production_requests_companyId_status_idx" ON "production_requests"("companyId", "status");

-- CreateIndex
CREATE INDEX "production_requests_companyId_status_submittedAt_idx" ON "production_requests"("companyId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "production_requests_companyId_batteryTypeId_idx" ON "production_requests"("companyId", "batteryTypeId");

-- CreateIndex
CREATE INDEX "production_requests_requestedById_idx" ON "production_requests"("requestedById");

-- CreateIndex
CREATE INDEX "production_request_events_productionRequestId_createdAt_idx" ON "production_request_events"("productionRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "production_request_events_actorId_idx" ON "production_request_events"("actorId");

-- AddForeignKey
ALTER TABLE "production_requests" ADD CONSTRAINT "production_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_requests" ADD CONSTRAINT "production_requests_batteryTypeId_fkey" FOREIGN KEY ("batteryTypeId") REFERENCES "battery_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_requests" ADD CONSTRAINT "production_requests_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "recipe_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_requests" ADD CONSTRAINT "production_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_requests" ADD CONSTRAINT "production_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_requests" ADD CONSTRAINT "production_requests_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_requests" ADD CONSTRAINT "production_requests_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_request_events" ADD CONSTRAINT "production_request_events_productionRequestId_fkey" FOREIGN KEY ("productionRequestId") REFERENCES "production_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_request_events" ADD CONSTRAINT "production_request_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
