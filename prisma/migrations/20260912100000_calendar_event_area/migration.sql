-- Área de producción del evento (uno de ORDER_AREAS), independiente de
-- "category": permite filtrar el calendario por área además de por
-- naturaleza del evento (instalación/visita/entrega/junta/otro).

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN "area" TEXT;

-- CreateIndex
CREATE INDEX "CalendarEvent_area_idx" ON "CalendarEvent"("area");
