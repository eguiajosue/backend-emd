-- Retira el catálogo de productos y el inventario.
--
-- Existían en la base y en la API pero nunca tuvieron interfaz, y los pedidos
-- siempre guardaron el producto como texto libre (OrderProduct.customName), así
-- que ningún pedido descontó stock jamás. Al aplicar esta migración las cinco
-- tablas estaban vacías y ninguna línea de pedido referenciaba un producto
-- (verificado contra la base de producción antes de escribirla).

-- 1. OrderProduct deja de apuntar al catálogo. `customName` pasa a obligatorio:
--    es el único nombre que la línea tuvo siempre.
ALTER TABLE "OrderProduct" DROP CONSTRAINT IF EXISTS "OrderProduct_productId_fkey";
DROP INDEX IF EXISTS "OrderProduct_productId_idx";
DROP INDEX IF EXISTS "OrderProduct_orderId_productId_key";
UPDATE "OrderProduct" SET "customName" = 'Sin nombre' WHERE "customName" IS NULL;
ALTER TABLE "OrderProduct" ALTER COLUMN "customName" SET NOT NULL;
ALTER TABLE "OrderProduct" DROP COLUMN IF EXISTS "productId";

-- 2. Las tablas del subsistema, en orden de dependencia.
DROP TABLE IF EXISTS "InventoryTransaction";
DROP TABLE IF EXISTS "Product";
DROP TABLE IF EXISTS "ProductType";
DROP TABLE IF EXISTS "Color";
DROP TABLE IF EXISTS "Size";
