-- Migrate User <-> Role from a one-to-many relation (User.roleId) to an
-- implicit many-to-many relation (Prisma join table "_RoleToUser"), so a
-- user can hold one or more roles simultaneously.

-- CreateTable: Prisma's implicit m2m join table for Role <-> User.
CREATE TABLE "_RoleToUser" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- Backfill: preserve each user's existing single role as their first role.
INSERT INTO "_RoleToUser" ("A", "B")
SELECT "roleId", "id" FROM "User";

-- CreateIndex
CREATE UNIQUE INDEX "_RoleToUser_AB_unique" ON "_RoleToUser"("A", "B");

-- CreateIndex
CREATE INDEX "_RoleToUser_B_index" ON "_RoleToUser"("B");

-- AddForeignKey
ALTER TABLE "_RoleToUser" ADD CONSTRAINT "_RoleToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RoleToUser" ADD CONSTRAINT "_RoleToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";

-- AlterTable: drop the old single-role foreign key column.
ALTER TABLE "User" DROP COLUMN "roleId";
