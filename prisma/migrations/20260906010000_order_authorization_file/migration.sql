-- Hoja de autorización del pedido (imagen o PDF), guardada como base64 en la
-- propia fila de Order. Todos los campos son opcionales: una orden puede no
-- tener archivo adjunto todavía.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "authorizationFileData" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "authorizationFileName" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "authorizationFileMime" TEXT;
