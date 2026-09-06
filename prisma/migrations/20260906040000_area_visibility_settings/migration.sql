-- CreateTable
CREATE TABLE "AreaVisibilitySetting" (
    "id" SERIAL NOT NULL,
    "role" TEXT NOT NULL,
    "generalViewEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AreaVisibilitySetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AreaVisibilitySetting_role_key" ON "AreaVisibilitySetting"("role");
