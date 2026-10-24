-- Etapas previas a producción configurables por área (fase 3 de áreas dinámicas).
-- Bordado deja de tener las etapas fijas (digitalizado → en pruebas) y pasa a
-- usar el mecanismo genérico: sus dos etapas se siembran aquí y las tareas en
-- curso conservan la etapa en la que estaban.
CREATE TYPE "AreaStageKind" AS ENUM ('work', 'review');

CREATE TABLE "AreaStage" (
    "id" SERIAL NOT NULL,
    "areaId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AreaStageKind" NOT NULL DEFAULT 'work',
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaStage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AreaStage_areaId_key_key" ON "AreaStage"("areaId", "key");
CREATE INDEX "AreaStage_areaId_idx" ON "AreaStage"("areaId");
ALTER TABLE "AreaStage" ADD CONSTRAINT "AreaStage_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Las dos etapas de Bordado (WORKFLOW.md §3.1).
INSERT INTO "AreaStage" ("areaId", "key", "name", "kind", "sortOrder", "updatedAt")
SELECT "id", 'digitalizado', 'Digitalizado', 'work', 10, CURRENT_TIMESTAMP FROM "Area" WHERE "slug" = 'bordado';
INSERT INTO "AreaStage" ("areaId", "key", "name", "kind", "sortOrder", "updatedAt")
SELECT "id", 'en_pruebas', 'En pruebas', 'review', 20, CURRENT_TIMESTAMP FROM "Area" WHERE "slug" = 'bordado';

ALTER TABLE "OrderAreaTask" ADD COLUMN "stageId" INTEGER;

-- Cada tarea conserva su etapa (prepStage NULL = ya produce: stageId NULL).
UPDATE "OrderAreaTask" t
SET "stageId" = s."id"
FROM "AreaStage" s
JOIN "Area" a ON a."id" = s."areaId"
WHERE a."slug" = 'bordado' AND t."prepStage" IS NOT NULL AND s."key" = t."prepStage"::text;

CREATE INDEX "OrderAreaTask_stageId_idx" ON "OrderAreaTask"("stageId");
ALTER TABLE "OrderAreaTask" ADD CONSTRAINT "OrderAreaTask_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "AreaStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderAreaTask" DROP COLUMN "prepStage";
DROP TYPE "EmbroideryPrepStage";
