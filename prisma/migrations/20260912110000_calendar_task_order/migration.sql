-- Vínculo opcional entre una tarea pendiente del calendario y un pedido
-- (ej. "confirmar medidas" de un pedido puntual), para poder avisar en la
-- tarjeta del pedido cuando tiene tareas relacionadas sin marcar.

-- AlterTable
ALTER TABLE "CalendarTask" ADD COLUMN "orderId" INTEGER;

-- CreateIndex
CREATE INDEX "CalendarTask_orderId_idx" ON "CalendarTask"("orderId");

-- AddForeignKey
ALTER TABLE "CalendarTask" ADD CONSTRAINT "CalendarTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
