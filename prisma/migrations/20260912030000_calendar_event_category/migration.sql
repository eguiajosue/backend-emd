-- Categoría de evento del calendario de equipo: distingue de un vistazo
-- instalaciones/visitas/entregas (con seguimiento de estado) de juntas
-- (sólo informativas, sin pendiente/en_proceso/terminado en la UI).

-- CreateEnum
CREATE TYPE "CalendarEventCategory" AS ENUM ('instalacion', 'visita', 'entrega', 'junta', 'otro');

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN "category" "CalendarEventCategory" NOT NULL DEFAULT 'otro';
