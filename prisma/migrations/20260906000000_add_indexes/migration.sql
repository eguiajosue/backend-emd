-- Índices para las claves foráneas y los campos por los que se filtra u ordena
-- con más frecuencia. PostgreSQL NO crea índices automáticamente para las FK,
-- así que sin esto cada listado/join hace secuencial sobre la tabla completa.
-- Se usa IF NOT EXISTS para que la migración sea idempotente contra una base
-- que ya tuviera alguno de estos índices.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Client_companyId_idx" ON "Client"("companyId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Client_last_name_first_name_idx" ON "Client"("last_name", "first_name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_statusId_idx" ON "Order"("statusId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_clientId_idx" ON "Order"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_deliveryDate_idx" ON "Order"("deliveryDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_creationDate_idx" ON "Order"("creationDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderHistory_orderId_idx" ON "OrderHistory"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderHistory_changeDate_idx" ON "OrderHistory"("changeDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderHistory_previousStatusId_idx" ON "OrderHistory"("previousStatusId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderHistory_newStatusId_idx" ON "OrderHistory"("newStatusId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InventoryTransaction_productId_idx" ON "InventoryTransaction"("productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InventoryTransaction_transactionDate_idx" ON "InventoryTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderProduct_productId_idx" ON "OrderProduct"("productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Log_userId_idx" ON "Log"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Log_logDate_idx" ON "Log"("logDate");
