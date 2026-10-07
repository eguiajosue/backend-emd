-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "branchId" INTEGER;

-- CreateIndex
CREATE INDEX "Client_branchId_idx" ON "Client"("branchId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

