-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "attachmentData" TEXT,
ADD COLUMN     "attachmentFilename" TEXT,
ADD COLUMN     "attachmentMimeType" TEXT,
ADD COLUMN     "attachmentSize" INTEGER,
ALTER COLUMN "body" DROP NOT NULL;
