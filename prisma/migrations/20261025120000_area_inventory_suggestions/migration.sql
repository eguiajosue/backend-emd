-- Sugerencias de categoría y unidad de inventario por área (las captura el
-- wizard de áreas, fase 2). Sólo sugieren: el inventario sigue aceptando texto libre.
ALTER TABLE "Area" ADD COLUMN "inventoryCategories" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Area" ADD COLUMN "inventoryUnits" TEXT[] DEFAULT ARRAY[]::TEXT[];
