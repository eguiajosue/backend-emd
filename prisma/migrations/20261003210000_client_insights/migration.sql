-- Aprendizaje por cliente: perfil de hábitos calculado del historial de
-- pedidos (qué suele pedir y cuánto, ruta de diseño/áreas, materiales,
-- anticipación de entrega y cadencia). Se recalcula al crear/borrar pedidos
-- del cliente o cambiar su hoja de materiales; ver ClientInsightService.

-- CreateTable
CREATE TABLE "ClientInsight" (
    "clientId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "ordersAnalyzed" INTEGER NOT NULL,
    "lastOrderAt" TIMESTAMP(3),
    "nextExpectedAt" TIMESTAMP(3),
    "cadenceRegular" BOOLEAN NOT NULL DEFAULT false,
    "profile" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientInsight_pkey" PRIMARY KEY ("clientId")
);

-- CreateIndex
CREATE INDEX "ClientInsight_nextExpectedAt_idx" ON "ClientInsight"("nextExpectedAt");

-- AddForeignKey
ALTER TABLE "ClientInsight" ADD CONSTRAINT "ClientInsight_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

