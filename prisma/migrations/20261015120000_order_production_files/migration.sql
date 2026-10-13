-- Archivos finales de producción (subidos por partes directo al bucket).
CREATE TABLE "OrderProductionFile" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "uploadId" TEXT,
    "version" INTEGER NOT NULL,
    "notes" TEXT,
    "uploadedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "OrderProductionFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderProductionFile_objectKey_key" ON "OrderProductionFile"("objectKey");
CREATE INDEX "OrderProductionFile_orderId_status_idx" ON "OrderProductionFile"("orderId", "status");
CREATE INDEX "OrderProductionFile_status_createdAt_idx" ON "OrderProductionFile"("status", "createdAt");

ALTER TABLE "OrderProductionFile" ADD CONSTRAINT "OrderProductionFile_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderProductionFile" ADD CONSTRAINT "OrderProductionFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
