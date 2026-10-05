-- Barra lateral personalizable y mockups v2: preferencias por usuario de la
-- barra (`navPreferences`) y de los colores del creador de mockups
-- (`mockupColors`), más las plantillas de mockup y la biblioteca de logos,
-- compartidas por la empresa. Si se borra el usuario que las creó, quedan
-- sin autor. Ver MockupTemplateService y MockupLogoService.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mockupColors" JSONB,
ADD COLUMN     "navPreferences" JSONB;

-- CreateTable
CREATE TABLE "MockupTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "garment" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "thumbnailData" TEXT NOT NULL,
    "thumbnailMime" TEXT NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockupTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockupLogo" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "imageData" TEXT NOT NULL,
    "imageMime" TEXT NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "MockupLogo_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MockupTemplate" ADD CONSTRAINT "MockupTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockupLogo" ADD CONSTRAINT "MockupLogo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

