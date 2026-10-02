-- AlterTable: orden de prioridad de compra (drag & drop) en Hoja de Materiales
ALTER TABLE "Order" ADD COLUMN "materialsPriority" INTEGER;

-- CreateIndex
CREATE INDEX "Order_materialsPriority_idx" ON "Order"("materialsPriority");
