-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationsMuted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyCriticalAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyMentionsOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyProductionUpdates" BOOLEAN NOT NULL DEFAULT true;
