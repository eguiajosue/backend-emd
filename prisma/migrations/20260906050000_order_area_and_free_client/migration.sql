-- Agrega el campo `area` (departamento) al pedido, independiente del `status` (flujo).
ALTER TABLE "Order" ADD COLUMN "area" TEXT;
CREATE INDEX "Order_area_idx" ON "Order"("area");

-- Permite pedidos con cliente no registrado: clientId pasa a ser opcional y
-- se agrega clientNameOverride para el nombre escrito a mano.
ALTER TABLE "Order" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "Order" ADD COLUMN "clientNameOverride" TEXT;
