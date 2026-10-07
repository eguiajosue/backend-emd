-- CreateEnum
CREATE TYPE "SupplySource" AS ENUM ('cliente', 'nosotros');

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "areaTaskId" INTEGER;

-- CreateTable
CREATE TABLE "OrderAreaSupply" (
    "id" SERIAL NOT NULL,
    "areaTaskId" INTEGER NOT NULL,
    "source" "SupplySource" NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderAreaSupply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAreaSupplyLine" (
    "id" SERIAL NOT NULL,
    "supplyId" INTEGER NOT NULL,
    "inventoryItemId" INTEGER,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "discountedAt" TIMESTAMP(3),

    CONSTRAINT "OrderAreaSupplyLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderAreaSupply_areaTaskId_key" ON "OrderAreaSupply"("areaTaskId");

-- CreateIndex
CREATE INDEX "OrderAreaSupplyLine_supplyId_idx" ON "OrderAreaSupplyLine"("supplyId");

-- CreateIndex
CREATE INDEX "OrderAreaSupplyLine_inventoryItemId_idx" ON "OrderAreaSupplyLine"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryMovement_areaTaskId_idx" ON "InventoryMovement"("areaTaskId");

-- AddForeignKey
ALTER TABLE "OrderAreaSupply" ADD CONSTRAINT "OrderAreaSupply_areaTaskId_fkey" FOREIGN KEY ("areaTaskId") REFERENCES "OrderAreaTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAreaSupplyLine" ADD CONSTRAINT "OrderAreaSupplyLine_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "OrderAreaSupply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAreaSupplyLine" ADD CONSTRAINT "OrderAreaSupplyLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

