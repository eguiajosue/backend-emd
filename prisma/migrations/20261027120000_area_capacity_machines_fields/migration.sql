-- Fase 4 de áreas dinámicas: capacidad y tiempos, máquinas y datos propios por área.
ALTER TABLE "Area" ADD COLUMN "capacity" INTEGER;
ALTER TABLE "Area" ADD COLUMN "turnaroundHours" INTEGER;

CREATE TABLE "AreaMachine" (
    "id" SERIAL NOT NULL,
    "areaId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaMachine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AreaMachine_areaId_idx" ON "AreaMachine"("areaId");
ALTER TABLE "AreaMachine" ADD CONSTRAINT "AreaMachine_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "AreaFieldType" AS ENUM ('text', 'number', 'select', 'boolean');

CREATE TABLE "AreaField" (
    "id" SERIAL NOT NULL,
    "areaId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "AreaFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaField_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AreaField_areaId_key_key" ON "AreaField"("areaId", "key");
CREATE INDEX "AreaField_areaId_idx" ON "AreaField"("areaId");
ALTER TABLE "AreaField" ADD CONSTRAINT "AreaField_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderAreaTask" ADD COLUMN "machineId" INTEGER;
ALTER TABLE "OrderAreaTask" ADD COLUMN "fieldValues" JSONB;
CREATE INDEX "OrderAreaTask_machineId_idx" ON "OrderAreaTask"("machineId");
ALTER TABLE "OrderAreaTask" ADD CONSTRAINT "OrderAreaTask_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "AreaMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
