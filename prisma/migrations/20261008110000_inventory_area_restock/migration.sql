-- CreateEnum
CREATE TYPE "RestockRequestStatus" AS ENUM ('PENDIENTE', 'EN_CAMINO', 'COMPRADO', 'RESUELTO');

-- CreateEnum
CREATE TYPE "RestockRequestUrgency" AS ENUM ('NORMAL', 'URGENTE');

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "area" TEXT,
ADD COLUMN     "balanceBefore" DECIMAL(12,3),
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "RestockRequest" (
    "id" SERIAL NOT NULL,
    "area" TEXT NOT NULL,
    "itemId" INTEGER,
    "itemName" TEXT NOT NULL,
    "quantity" DECIMAL(12,3),
    "unit" TEXT,
    "comment" TEXT,
    "urgency" "RestockRequestUrgency" NOT NULL DEFAULT 'NORMAL',
    "status" "RestockRequestStatus" NOT NULL DEFAULT 'PENDIENTE',
    "statusNote" TEXT,
    "requestedById" INTEGER NOT NULL,
    "handledById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RestockRequest_status_createdAt_idx" ON "RestockRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RestockRequest_area_createdAt_idx" ON "RestockRequest"("area", "createdAt");

-- CreateIndex
CREATE INDEX "RestockRequest_itemId_idx" ON "RestockRequest"("itemId");

-- CreateIndex
CREATE INDEX "InventoryMovement_area_createdAt_idx" ON "InventoryMovement"("area", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_createdById_createdAt_idx" ON "InventoryMovement"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Bitácora: los movimientos existentes toman el departamento actual de su artículo.
UPDATE "InventoryMovement" AS m
SET "area" = i."area"
FROM "InventoryItem" AS i
WHERE m."itemId" = i."id" AND m."area" IS NULL;
