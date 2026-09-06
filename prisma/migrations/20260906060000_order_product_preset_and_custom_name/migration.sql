-- Catálogo simple de "productos frecuentes" (texto libre en las líneas de pedido).
CREATE TABLE "OrderProductPreset" (
    "id"   SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "OrderProductPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderProductPreset_name_key" ON "OrderProductPreset"("name");

-- OrderProduct: permite líneas de producto con texto libre (customName) en
-- vez de un `productId` del catálogo complejo (Product). Se reemplaza la
-- clave primaria compuesta (orderId, productId) por un id propio, ya que
-- productId ahora puede ser null.
ALTER TABLE "OrderProduct" DROP CONSTRAINT "OrderProduct_pkey";
ALTER TABLE "OrderProduct" DROP CONSTRAINT "OrderProduct_productId_fkey";
ALTER TABLE "OrderProduct" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "OrderProduct" ADD COLUMN "customName" TEXT;
ALTER TABLE "OrderProduct" ALTER COLUMN "productId" DROP NOT NULL;

ALTER TABLE "OrderProduct" ADD CONSTRAINT "OrderProduct_pkey" PRIMARY KEY ("id");
ALTER TABLE "OrderProduct" ADD CONSTRAINT "OrderProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "OrderProduct_orderId_productId_key" ON "OrderProduct"("orderId", "productId");
CREATE INDEX "OrderProduct_orderId_idx" ON "OrderProduct"("orderId");
