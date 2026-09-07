-- Tareas de área por pedido (multi-área en paralelo).
--
-- Un pedido puede requerir varias áreas de producción (ej. bordado + dtf) y
-- todas trabajan a la vez: cada una lleva su propio estado y responsable.
-- Cuando todas quedan en 'terminado', el pedido pasa a "listo para entregar"
-- (Status id=4, 'terminado') y Recepción confirma la entrega a mano.
-- Ver WORKFLOW.md §3.

-- CreateEnum
CREATE TYPE "AreaTaskStatus" AS ENUM ('pendiente', 'en_proceso', 'terminado');

-- CreateTable
CREATE TABLE "OrderAreaTask" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "area" TEXT NOT NULL,
    "status" "AreaTaskStatus" NOT NULL DEFAULT 'pendiente',
    "assignedUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OrderAreaTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderAreaTask_orderId_area_key" ON "OrderAreaTask"("orderId", "area");
CREATE INDEX "OrderAreaTask_orderId_idx" ON "OrderAreaTask"("orderId");
CREATE INDEX "OrderAreaTask_area_idx" ON "OrderAreaTask"("area");
CREATE INDEX "OrderAreaTask_assignedUserId_idx" ON "OrderAreaTask"("assignedUserId");
CREATE INDEX "OrderAreaTask_status_idx" ON "OrderAreaTask"("status");

-- AddForeignKey
ALTER TABLE "OrderAreaTask" ADD CONSTRAINT "OrderAreaTask_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderAreaTask" ADD CONSTRAINT "OrderAreaTask_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: cada pedido de producción existente (no en Diseño, no entregado ni
-- cancelado) se convierte en una tarea de su área actual, conservando
-- responsable y traduciendo su estado global al ciclo corto de la tarea.
INSERT INTO "OrderAreaTask" ("orderId", "area", "status", "assignedUserId", "createdAt")
SELECT
    o."id",
    o."area",
    CASE
        WHEN o."statusId" = 4 THEN 'terminado'::"AreaTaskStatus"
        WHEN o."statusId" = 3 THEN 'en_proceso'::"AreaTaskStatus"
        ELSE 'pendiente'::"AreaTaskStatus"
    END,
    o."assignedUserId",
    o."creationDate"
FROM "Order" o
WHERE o."area" IS NOT NULL
  AND o."area" <> 'diseno'
  AND o."statusId" NOT IN (5, 10);
