-- Código de barras (Code 128) de cada artículo de inventario, para imprimir
-- etiquetas y escanearlas en Entradas/Salidas. Único en todo el inventario
-- (no por departamento): un escaneo identifica un solo artículo.
-- Por omisión es "EMD-" + id con ceros a la izquierda (EMD-000123); los
-- artículos nuevos lo reciben al darse de alta (ver InventoryService.create).

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_barcode_key" ON "InventoryItem"("barcode");

-- Backfill: los artículos existentes reciben su código por omisión. lpad
-- recorta cadenas más largas que 6, así que los id de 7+ dígitos van tal cual
-- (igual que String(id).padStart(6, '0') en el servicio).
UPDATE "InventoryItem"
SET "barcode" = 'EMD-' || CASE
    WHEN length("id"::text) >= 6 THEN "id"::text
    ELSE lpad("id"::text, 6, '0')
  END
WHERE "barcode" IS NULL;
