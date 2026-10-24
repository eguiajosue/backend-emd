-- Áreas de trabajo como catálogo administrable (fase 1 de áreas dinámicas).
--
-- Antes cada área era un ROL fijo en código (taller, dtf, bordado, diseno,
-- laser, impresiones) y su visibilidad vivía en "AreaVisibilitySetting".
-- Ahora el área es una fila de "Area" y la pertenencia de cada persona a un
-- área es la relación "_AreaToUser", separada de los roles. Los slugs no
-- cambian: Order.area, OrderAreaTask.area, InventoryItem.area y los canales
-- de chat siguen guardando el mismo texto.

-- CreateTable
CREATE TABLE "Area" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isDesign" BOOLEAN NOT NULL DEFAULT false,
    "isProductionDestination" BOOLEAN NOT NULL DEFAULT true,
    "hasInventory" BOOLEAN NOT NULL DEFAULT true,
    "generalViewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable: join table implícita de Prisma para Area <-> User.
CREATE TABLE "_AreaToUser" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Area_slug_key" ON "Area"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Area_name_key" ON "Area"("name");

-- CreateIndex
CREATE UNIQUE INDEX "_AreaToUser_AB_unique" ON "_AreaToUser"("A", "B");

-- CreateIndex
CREATE INDEX "_AreaToUser_B_index" ON "_AreaToUser"("B");

-- AddForeignKey
ALTER TABLE "_AreaToUser" ADD CONSTRAINT "_AreaToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AreaToUser" ADD CONSTRAINT "_AreaToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Las seis áreas de siempre, con el mismo nombre, ícono y color que tenían
-- fijos en el frontend, y la visibilidad general que ya estaba configurada.
INSERT INTO "Area" ("slug", "name", "icon", "color", "isDesign", "isProductionDestination", "hasInventory", "generalViewEnabled", "sortOrder", "updatedAt")
SELECT v.slug, v.name, v.icon, v.color, v.is_design, NOT v.is_design, true,
       COALESCE((SELECT s."generalViewEnabled" FROM "AreaVisibilitySetting" s WHERE s."role" = v.slug), true),
       v.sort_order, CURRENT_TIMESTAMP
FROM (VALUES
    ('taller',      'Taller',      'Hammer',   '#c5d629', false, 10),
    ('dtf',         'DTF',         'Layers',   '#30b7cf', false, 20),
    ('bordado',     'Bordado',     'Scissors', '#e24091', false, 30),
    ('diseno',      'Diseño',      'PenTool',  '#6659c0', true,  40),
    ('laser',       'Láser',       'Zap',      '#f68a1e', false, 50),
    ('impresiones', 'Impresiones', 'Printer',  '#3583e9', false, 60)
) AS v(slug, name, icon, color, is_design, sort_order);

-- Quien tenía el rol de un área pasa a pertenecer a esa área.
INSERT INTO "_AreaToUser" ("A", "B")
SELECT a."id", ru."B"
FROM "_RoleToUser" ru
JOIN "Role" r ON r."id" = ru."A"
JOIN "Area" a ON a."slug" = r."name";

-- Los roles de área dejan de existir: el acceso ahora sale de la pertenencia.
DELETE FROM "_RoleToUser"
WHERE "A" IN (SELECT "id" FROM "Role" WHERE "name" IN ('taller', 'dtf', 'bordado', 'diseno', 'laser', 'impresiones'));

DELETE FROM "Role" WHERE "name" IN ('taller', 'dtf', 'bordado', 'diseno', 'laser', 'impresiones');

-- La visibilidad general vive ahora en "Area".
DROP TABLE "AreaVisibilitySetting";
