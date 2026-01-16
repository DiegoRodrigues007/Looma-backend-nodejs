/*
  Warnings:

  - A unique constraint covering the columns `[userId,instagramId]` on the table `InstagramAccounts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[instagramAccountId,igMediaId]` on the table `InstagramPosts` will be added. If there are existing duplicate values, this will fail.
  - Made the column `instagramAccountId` on table `InstagramBackfillJobs` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `instagramAccountId` to the `InstagramPosts` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "InstagramBackfillJobs" DROP CONSTRAINT "InstagramBackfillJobs_instagramAccountId_fkey";

-- DropIndex
DROP INDEX "InstagramAccounts_instagramId_key";

-- DropIndex
DROP INDEX "InstagramPosts_igMediaId_key";

-- AlterTable
ALTER TABLE "InstagramBackfillJobs" ALTER COLUMN "instagramAccountId" SET NOT NULL;

-- AlterTable
ALTER TABLE "InstagramPosts" ADD COLUMN     "instagramAccountId" TEXT NOT NULL,
ADD COLUMN     "thumb" TEXT;

-- CreateTable
CREATE TABLE "InstagramCandidates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT,
    "accountType" TEXT,
    "facebookPageId" TEXT NOT NULL,
    "facebookPageName" TEXT,
    "pageAccessToken" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "instagramAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "selectedAt" TIMESTAMP(3),

    CONSTRAINT "InstagramCandidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramFollowersDaily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramFollowersDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstagramCandidates_userId_createdAt_idx" ON "InstagramCandidates"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "InstagramCandidates_userId_selectionId_createdAt_idx" ON "InstagramCandidates"("userId", "selectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramCandidates_userId_selectionId_key" ON "InstagramCandidates"("userId", "selectionId");

-- CreateIndex
CREATE INDEX "InstagramFollowersDaily_userId_igUserId_day_idx" ON "InstagramFollowersDaily"("userId", "igUserId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramFollowersDaily_userId_igUserId_day_key" ON "InstagramFollowersDaily"("userId", "igUserId", "day");

-- CreateIndex
CREATE INDEX "InstagramAccounts_instagramId_idx" ON "InstagramAccounts"("instagramId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccounts_userId_instagramId_key" ON "InstagramAccounts"("userId", "instagramId");

-- CreateIndex
CREATE INDEX "InstagramPosts_instagramAccountId_publishedAt_idx" ON "InstagramPosts"("instagramAccountId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramPosts_instagramAccountId_igMediaId_key" ON "InstagramPosts"("instagramAccountId", "igMediaId");

-- AddForeignKey
ALTER TABLE "InstagramCandidates" ADD CONSTRAINT "InstagramCandidates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramCandidates" ADD CONSTRAINT "InstagramCandidates_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramFollowersDaily" ADD CONSTRAINT "InstagramFollowersDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramPosts" ADD CONSTRAINT "InstagramPosts_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramBackfillJobs" ADD CONSTRAINT "InstagramBackfillJobs_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
