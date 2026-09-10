-- AlterTable
ALTER TABLE "ChatConversationMember" ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
