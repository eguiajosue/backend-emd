-- Plantillas de pedido por cliente.
--
-- Lo que un cliente suele pedir, guardado con nombre ("Figuras de
-- coroplast"): productos y cantidades, descripción base, ruta de
-- diseño/producción y hoja de materiales. Recepción la elige al dar de alta
-- un pedido y el formulario se precarga (siempre editable). No guarda fecha
-- de entrega, archivo del cliente ni asignado: cambian en cada pedido.

-- CreateTable
CREATE TABLE "OrderTemplate" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "requiresDesign" BOOLEAN NOT NULL DEFAULT true,
    "productionAreas" TEXT[],
    "description" TEXT NOT NULL DEFAULT '',
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTemplateProduct" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "customName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OrderTemplateProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTemplateMaterial" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "supplierId" INTEGER,

    CONSTRAINT "OrderTemplateMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderTemplate_clientId_idx" ON "OrderTemplate"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTemplate_clientId_name_key" ON "OrderTemplate"("clientId", "name");

-- CreateIndex
CREATE INDEX "OrderTemplateProduct_templateId_idx" ON "OrderTemplateProduct"("templateId");

-- CreateIndex
CREATE INDEX "OrderTemplateMaterial_templateId_idx" ON "OrderTemplateMaterial"("templateId");

-- CreateIndex
CREATE INDEX "OrderTemplateMaterial_materialId_idx" ON "OrderTemplateMaterial"("materialId");

-- AddForeignKey
ALTER TABLE "OrderTemplate" ADD CONSTRAINT "OrderTemplate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplate" ADD CONSTRAINT "OrderTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateProduct" ADD CONSTRAINT "OrderTemplateProduct_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OrderTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateMaterial" ADD CONSTRAINT "OrderTemplateMaterial_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OrderTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateMaterial" ADD CONSTRAINT "OrderTemplateMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateMaterial" ADD CONSTRAINT "OrderTemplateMaterial_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

