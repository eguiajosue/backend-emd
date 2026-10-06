-- Cotizaciones de Recepción: etapa (por_enviar | enviada) y subestado
-- coherente con la etapa, prioridad por fecha, y el pedido en que se
-- convirtió cuando el cliente la acepta (único: un pedido sale de una sola
-- cotización). Si se borra el cliente, el pedido o el usuario que la cargó,
-- la cotización queda (SET NULL). Ver QuoteService.

-- CreateTable
CREATE TABLE "Quote" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER,
    "clientName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "comment" TEXT,
    "priorityDate" DATE,
    "sentAt" TIMESTAMP(3),
    "orderId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_orderId_key" ON "Quote"("orderId");

-- CreateIndex
CREATE INDEX "Quote_stage_status_idx" ON "Quote"("stage", "status");

-- CreateIndex
CREATE INDEX "Quote_priorityDate_idx" ON "Quote"("priorityDate");

-- CreateIndex
CREATE INDEX "Quote_updatedAt_idx" ON "Quote"("updatedAt");

-- CreateIndex
CREATE INDEX "Quote_clientId_idx" ON "Quote"("clientId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

