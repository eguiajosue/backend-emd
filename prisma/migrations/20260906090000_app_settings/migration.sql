-- Fila única de configuración global de la aplicación.
CREATE TABLE "AppSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "deliveredRetentionHours" INTEGER NOT NULL DEFAULT 48,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppSetting" ("id", "deliveredRetentionHours") VALUES (1, 48)
ON CONFLICT ("id") DO NOTHING;
