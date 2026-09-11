-- Varios archivos por ronda de diseño (montaje y feedback).
--
-- Una ronda puede llevar varias imágenes o un PDF, tanto del lado del montaje
-- que manda Diseño como del feedback que carga Recepción (WORKFLOW.md §2).
-- Los campos escalares `montageFile*`/`feedbackFile*` de "DesignRevision" se
-- mantienen: siguen guardando el PRIMER archivo de cada tipo para no romper a
-- los clientes que sólo conocen un archivo por ronda.

-- CreateTable
CREATE TABLE "DesignRevisionFile" (
    "id" SERIAL NOT NULL,
    "revisionId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignRevisionFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignRevisionFile_revisionId_idx" ON "DesignRevisionFile"("revisionId");
CREATE INDEX "DesignRevisionFile_revisionId_kind_idx" ON "DesignRevisionFile"("revisionId", "kind");

-- AddForeignKey
ALTER TABLE "DesignRevisionFile" ADD CONSTRAINT "DesignRevisionFile_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "DesignRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: cada ronda existente pasa su archivo único (si lo tiene) a la
-- tabla nueva, para que el listado multi-archivo los muestre desde el día uno.
INSERT INTO "DesignRevisionFile" ("revisionId", "kind", "data", "filename", "mimeType", "position", "createdAt")
SELECT r."id", 'montage', r."montageFileData", r."montageFileName", r."montageFileMime", 0, COALESCE(r."sentAt", r."createdAt")
FROM "DesignRevision" r
WHERE r."montageFileData" IS NOT NULL
  AND r."montageFileName" IS NOT NULL
  AND r."montageFileMime" IS NOT NULL;

INSERT INTO "DesignRevisionFile" ("revisionId", "kind", "data", "filename", "mimeType", "position", "createdAt")
SELECT r."id", 'feedback', r."feedbackFileData", r."feedbackFileName", r."feedbackFileMime", 0, COALESCE(r."feedbackAt", r."createdAt")
FROM "DesignRevision" r
WHERE r."feedbackFileData" IS NOT NULL
  AND r."feedbackFileName" IS NOT NULL
  AND r."feedbackFileMime" IS NOT NULL;
