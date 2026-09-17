-- Disponibilidad de abastecimiento por línea de la hoja de materiales de un
-- pedido (no es propiedad del catálogo de Materiales, que no lleva stock).

-- CreateEnum
CREATE TYPE "OrderMaterialAvailability" AS ENUM ('disponible', 'parcial', 'por_comprar', 'agotado', 'no_requerido');

-- AlterTable
ALTER TABLE "OrderMaterialItem" ADD COLUMN "availability" "OrderMaterialAvailability" NOT NULL DEFAULT 'disponible';
