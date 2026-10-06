-- Almacenamiento de objetos (Cloudflare R2 / S3) para los archivos que hoy
-- viven en base64 dentro de Postgres. Aditiva y sin pérdida de datos: agrega
-- una columna `<campo>Key` por cada blob y vuelve nullable la columna base64,
-- así cada fila es legacy (dato en la DB) o migrada (clave en el storage).
-- Ver src/storage y docs/storage-r2.md.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "clientResourceFileKey" TEXT;

-- AlterTable
ALTER TABLE "DesignRevision" ADD COLUMN     "feedbackFileKey" TEXT,
ADD COLUMN     "montageFileKey" TEXT;

-- AlterTable
ALTER TABLE "DesignRevisionFile" ADD COLUMN     "dataKey" TEXT,
ALTER COLUMN "data" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "attachmentKey" TEXT;

-- AlterTable
ALTER TABLE "OrderMockup" ADD COLUMN     "imageKey" TEXT,
ALTER COLUMN "imageData" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MockupTemplate" ADD COLUMN     "thumbnailKey" TEXT,
ALTER COLUMN "thumbnailData" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MockupLogo" ADD COLUMN     "imageKey" TEXT,
ADD COLUMN     "thumbnailKey" TEXT,
ALTER COLUMN "imageData" DROP NOT NULL,
ALTER COLUMN "thumbnailData" DROP NOT NULL;

