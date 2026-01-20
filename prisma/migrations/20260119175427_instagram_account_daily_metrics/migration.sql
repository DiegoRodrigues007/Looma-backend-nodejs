/*
  Warnings:

  - You are about to drop the `InstagramFollowersDaily` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `InstagramProfileViewsDaily` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "InstagramFollowersDaily" DROP CONSTRAINT "InstagramFollowersDaily_instagramAccountId_fkey";

-- DropForeignKey
ALTER TABLE "InstagramFollowersDaily" DROP CONSTRAINT "InstagramFollowersDaily_userId_fkey";

-- DropForeignKey
ALTER TABLE "InstagramProfileViewsDaily" DROP CONSTRAINT "InstagramProfileViewsDaily_instagramAccountId_fkey";

-- DropForeignKey
ALTER TABLE "InstagramProfileViewsDaily" DROP CONSTRAINT "InstagramProfileViewsDaily_userId_fkey";

-- DropTable
DROP TABLE "InstagramFollowersDaily";

-- DropTable
DROP TABLE "InstagramProfileViewsDaily";

-- CreateTable
CREATE TABLE "InstagramAccountDailyMetrics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "profileViewsTotal" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "totalInteractions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramAccountDailyMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstagramAccountDailyMetrics_userId_instagramAccountId_day_idx" ON "InstagramAccountDailyMetrics"("userId", "instagramAccountId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccountDailyMetrics_instagramAccountId_day_key" ON "InstagramAccountDailyMetrics"("instagramAccountId", "day");

-- AddForeignKey
ALTER TABLE "InstagramAccountDailyMetrics" ADD CONSTRAINT "InstagramAccountDailyMetrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramAccountDailyMetrics" ADD CONSTRAINT "InstagramAccountDailyMetrics_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
