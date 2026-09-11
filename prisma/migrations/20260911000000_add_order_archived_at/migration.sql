-- Archivado explícito del pedido al autorizar el montaje.
--
-- Al autorizarse la ronda de diseño el pedido sale del tablero activo de
-- Diseño, pero sigue existiendo en el historial: `archivedAt` es ese
-- marcador. El frontend filtra el tablero de Diseño por `archivedAt IS NULL`.
-- Ver WORKFLOW.md §2.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "archivedAt" TIMESTAMP(3);
