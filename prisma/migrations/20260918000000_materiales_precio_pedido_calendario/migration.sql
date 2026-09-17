-- Revierte "disponibilidad" de la hoja de materiales (no se va a usar) y
-- agrega: precio sugerido por material, precio+checklist de compra por línea
-- de la hoja de materiales, y vínculo opcional de un evento de calendario a
-- un pedido (con la categoría "compras" para el evento auto-generado de
-- "Compra de materiales").

-- DropColumn (revierte OrderMaterialItem.availability)
ALTER TABLE "OrderMaterialItem" DROP COLUMN "availability";

-- DropEnum (revierte OrderMaterialAvailability)
DROP TYPE "OrderMaterialAvailability";

-- AlterTable: precio de referencia del material (catálogo)
ALTER TABLE "Material" ADD COLUMN "suggestedPrice" DECIMAL(10,2);

-- AlterTable: precio (copiado/sincronizado) y checklist de compra por línea
ALTER TABLE "OrderMaterialItem" ADD COLUMN "price" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "OrderMaterialItem" ADD COLUMN "purchased" BOOLEAN NOT NULL DEFAULT false;

-- AlterEnum: nueva categoría de evento para "Compra de materiales"
ALTER TYPE "CalendarEventCategory" ADD VALUE 'compras';

-- AlterTable: vínculo opcional de un evento de calendario a un pedido
ALTER TABLE "CalendarEvent" ADD COLUMN "orderId" INTEGER;

-- CreateIndex
CREATE INDEX "CalendarEvent_orderId_idx" ON "CalendarEvent"("orderId");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
