-- Foto opcional de cada prueba de bordado, para que Recepción la revise y autorice.
ALTER TABLE "AreaTaskSampleTest" ADD COLUMN "photoData" TEXT;
ALTER TABLE "AreaTaskSampleTest" ADD COLUMN "photoKey" TEXT;
ALTER TABLE "AreaTaskSampleTest" ADD COLUMN "photoName" TEXT;
ALTER TABLE "AreaTaskSampleTest" ADD COLUMN "photoMime" TEXT;
