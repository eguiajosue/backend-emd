-- Mockups 3D adjuntados a un pedido: lámina PNG/JPEG exportada del creador
-- de mockups (playera/gorra con los diseños del cliente) en base64, más la
-- configuración del estudio (colores, diseños y posiciones) para volver a
-- editarlo. Se borran junto con el pedido; si se borra el usuario que lo
-- adjuntó, queda sin autor. Ver OrderMockupService.

-- CreateTable
CREATE TABLE "OrderMockup" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "garment" TEXT NOT NULL,
    "imageData" TEXT NOT NULL,
    "imageMime" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMockup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderMockup_orderId_idx" ON "OrderMockup"("orderId");

-- AddForeignKey
ALTER TABLE "OrderMockup" ADD CONSTRAINT "OrderMockup_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMockup" ADD CONSTRAINT "OrderMockup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

