-- CreateEnum
CREATE TYPE "MaterialUnit" AS ENUM ('KG', 'G', 'LITRES', 'ML', 'PIECES');

-- CreateEnum
CREATE TYPE "StockItemType" AS ENUM ('RAW_MATERIAL', 'FINISHED_BATTERY');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING_STOCK', 'RECEIPT', 'PRODUCTION_CONSUMPTION', 'PRODUCTION_OUTPUT', 'DISPATCH', 'ADJUSTMENT', 'REVERSAL');

-- CreateTable
CREATE TABLE "raw_materials" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "MaterialUnit" NOT NULL,
    "lowStockThreshold" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currentStock" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battery_types" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "battery_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_versions" (
    "id" SERIAL NOT NULL,
    "batteryTypeId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_items" (
    "id" SERIAL NOT NULL,
    "recipeVersionId" INTEGER NOT NULL,
    "rawMaterialId" INTEGER NOT NULL,
    "quantityPerUnit" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "itemType" "StockItemType" NOT NULL,
    "movementType" "StockMovementType" NOT NULL,
    "rawMaterialId" INTEGER,
    "batteryTypeId" INTEGER,
    "quantityChange" DECIMAL(18,4) NOT NULL,
    "resultingBalance" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceId" INTEGER,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "raw_materials_companyId_idx" ON "raw_materials"("companyId");

-- CreateIndex
CREATE INDEX "raw_materials_companyId_active_idx" ON "raw_materials"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "raw_materials_companyId_name_key" ON "raw_materials"("companyId", "name");

-- CreateIndex
CREATE INDEX "battery_types_companyId_idx" ON "battery_types"("companyId");

-- CreateIndex
CREATE INDEX "battery_types_companyId_active_idx" ON "battery_types"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "battery_types_companyId_name_key" ON "battery_types"("companyId", "name");

-- CreateIndex
CREATE INDEX "recipe_versions_batteryTypeId_isActive_idx" ON "recipe_versions"("batteryTypeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_versions_batteryTypeId_version_key" ON "recipe_versions"("batteryTypeId", "version");

-- CreateIndex
CREATE INDEX "recipe_items_recipeVersionId_idx" ON "recipe_items"("recipeVersionId");

-- CreateIndex
CREATE INDEX "recipe_items_rawMaterialId_idx" ON "recipe_items"("rawMaterialId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_items_recipeVersionId_rawMaterialId_key" ON "recipe_items"("recipeVersionId", "rawMaterialId");

-- CreateIndex
CREATE INDEX "stock_movements_companyId_createdAt_idx" ON "stock_movements"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_companyId_itemType_rawMaterialId_idx" ON "stock_movements"("companyId", "itemType", "rawMaterialId");

-- CreateIndex
CREATE INDEX "stock_movements_companyId_itemType_batteryTypeId_idx" ON "stock_movements"("companyId", "itemType", "batteryTypeId");

-- CreateIndex
CREATE INDEX "stock_movements_companyId_referenceType_referenceId_idx" ON "stock_movements"("companyId", "referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battery_types" ADD CONSTRAINT "battery_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_batteryTypeId_fkey" FOREIGN KEY ("batteryTypeId") REFERENCES "battery_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "recipe_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batteryTypeId_fkey" FOREIGN KEY ("batteryTypeId") REFERENCES "battery_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
