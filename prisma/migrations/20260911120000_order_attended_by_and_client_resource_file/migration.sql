-- 1) "Atender" un pedido en Recepción (WORKFLOW.md §2).
--
-- Las notificaciones del circuito iban SÓLO a la recepcionista que creó el
-- pedido (`Order.userId`): si esa persona estaba de franco, el pedido se
-- trababa porque nadie más se enteraba. Ahora otra recepcionista puede TOMAR
-- el pedido y se guardan las dos cosas: quién lo creó (`userId`, que no cambia
-- nunca) y quién lo atiende hoy (`attendedByUserId`).

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "attendedByUserId" INTEGER;

-- CreateIndex
CREATE INDEX "Order_attendedByUserId_idx" ON "Order"("attendedByUserId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_attendedByUserId_fkey" FOREIGN KEY ("attendedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Rename del archivo del alta: NO es la hoja de autorización.
--
-- La hoja de autorización real es el montaje que sube Diseño en cada ronda
-- (`DesignRevision`). Lo que carga Recepción al dar de alta el pedido son los
-- RECURSOS QUE MANDA EL CLIENTE (logo, referencias) para poder hacer el
-- diseño, y es opcional. El nombre viejo hacía que Recepción subiera la cosa
-- equivocada.
--
-- RENAME (no DROP + ADD): preserva los datos ya cargados.

-- RenameColumn
ALTER TABLE "Order" RENAME COLUMN "authorizationFileData" TO "clientResourceFileData";
ALTER TABLE "Order" RENAME COLUMN "authorizationFileName" TO "clientResourceFileName";
ALTER TABLE "Order" RENAME COLUMN "authorizationFileMime" TO "clientResourceFileMime";
