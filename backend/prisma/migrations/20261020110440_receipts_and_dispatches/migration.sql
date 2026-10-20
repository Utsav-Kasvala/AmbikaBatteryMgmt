-- AlterEnum
ALTER TYPE "ProductionRequestEventType" ADD VALUE 'REVERSED';

-- AlterEnum
ALTER TYPE "ProductionRequestStatus" ADD VALUE 'REVERSED';

-- CreateTable
CREATE TABLE "material_receipts" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "rawMaterialId" INTEGER NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "receivedById" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatches" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "batteryTypeId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "traderName" TEXT NOT NULL,
    "notes" TEXT,
    "dispatchedById" INTEGER NOT NULL,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_receipts_companyId_receivedAt_idx" ON "material_receipts"("companyId", "receivedAt");

-- CreateIndex
CREATE INDEX "material_receipts_companyId_rawMaterialId_receivedAt_idx" ON "material_receipts"("companyId", "rawMaterialId", "receivedAt");

-- CreateIndex
CREATE INDEX "dispatches_companyId_dispatchedAt_idx" ON "dispatches"("companyId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "dispatches_companyId_batteryTypeId_dispatchedAt_idx" ON "dispatches"("companyId", "batteryTypeId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "dispatches_companyId_traderName_idx" ON "dispatches"("companyId", "traderName");

-- AddForeignKey
ALTER TABLE "material_receipts" ADD CONSTRAINT "material_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_receipts" ADD CONSTRAINT "material_receipts_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_receipts" ADD CONSTRAINT "material_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_batteryTypeId_fkey" FOREIGN KEY ("batteryTypeId") REFERENCES "battery_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
