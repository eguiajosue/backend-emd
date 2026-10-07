-- AlterTable
ALTER TABLE "User" ADD COLUMN     "branchId" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "branchEmployeeId" INTEGER,
ADD COLUMN     "branchId" INTEGER;

-- AlterTable
ALTER TABLE "OrderMockup" ADD COLUMN     "branchEmployeeId" INTEGER;

-- CreateTable
CREATE TABLE "Branch" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchEmployee" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");

-- CreateIndex
CREATE INDEX "BranchEmployee_branchId_idx" ON "BranchEmployee"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchEmployee_branchId_name_key" ON "BranchEmployee"("branchId", "name");

-- CreateIndex
CREATE INDEX "Order_branchId_idx" ON "Order"("branchId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_branchEmployeeId_fkey" FOREIGN KEY ("branchEmployeeId") REFERENCES "BranchEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMockup" ADD CONSTRAINT "OrderMockup_branchEmployeeId_fkey" FOREIGN KEY ("branchEmployeeId") REFERENCES "BranchEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchEmployee" ADD CONSTRAINT "BranchEmployee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

