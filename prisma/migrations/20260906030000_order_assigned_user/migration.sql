-- AlterTable
ALTER TABLE "Order" ADD COLUMN "assignedUserId" INTEGER;

-- CreateIndex
CREATE INDEX "Order_assignedUserId_idx" ON "Order"("assignedUserId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
