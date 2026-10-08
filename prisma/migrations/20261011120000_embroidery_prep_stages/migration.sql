-- Bordado: etapas previas a producción (digitalizado → en pruebas) y registro de pruebas.
CREATE TYPE "EmbroideryPrepStage" AS ENUM ('digitalizado', 'en_pruebas');
CREATE TYPE "SampleTestResult" AS ENUM ('aprobada', 'rechazada');

-- Las tareas existentes quedan con prepStage NULL: ya están en curso y no pasan por las etapas nuevas.
ALTER TABLE "OrderAreaTask" ADD COLUMN "prepStage" "EmbroideryPrepStage";

CREATE TABLE "AreaTaskSampleTest" (
    "id" SERIAL NOT NULL,
    "areaTaskId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentByUserId" INTEGER,
    "sentNotes" TEXT,
    "result" "SampleTestResult",
    "resultNotes" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" INTEGER,

    CONSTRAINT "AreaTaskSampleTest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AreaTaskSampleTest_areaTaskId_round_key" ON "AreaTaskSampleTest"("areaTaskId", "round");
CREATE INDEX "AreaTaskSampleTest_areaTaskId_idx" ON "AreaTaskSampleTest"("areaTaskId");

ALTER TABLE "AreaTaskSampleTest" ADD CONSTRAINT "AreaTaskSampleTest_areaTaskId_fkey" FOREIGN KEY ("areaTaskId") REFERENCES "OrderAreaTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AreaTaskSampleTest" ADD CONSTRAINT "AreaTaskSampleTest_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AreaTaskSampleTest" ADD CONSTRAINT "AreaTaskSampleTest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
