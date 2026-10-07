-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "logoOnDarkData" TEXT,
ADD COLUMN     "logoOnDarkKey" TEXT,
ADD COLUMN     "logoOnDarkMime" TEXT,
ADD COLUMN     "logoOnLightData" TEXT,
ADD COLUMN     "logoOnLightKey" TEXT,
ADD COLUMN     "logoOnLightMime" TEXT,
ADD COLUMN     "logoUpdatedAt" TIMESTAMP(3);

