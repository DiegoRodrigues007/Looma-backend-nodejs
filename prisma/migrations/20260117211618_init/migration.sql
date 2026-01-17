/*
  Warnings:

  - You are about to drop the column `igUserId` on the `InstagramFollowersDaily` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[instagramAccountId,day]` on the table `InstagramFollowersDaily` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `instagramAccountId` to the `InstagramFollowersDaily` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "InstagramFollowersDaily_userId_igUserId_day_idx";

-- DropIndex
DROP INDEX "InstagramFollowersDaily_userId_igUserId_day_key";

-- AlterTable
ALTER TABLE "InstagramFollowersDaily" DROP COLUMN "igUserId",
ADD COLUMN     "instagramAccountId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "InstagramFollowersDaily_userId_instagramAccountId_day_idx" ON "InstagramFollowersDaily"("userId", "instagramAccountId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramFollowersDaily_instagramAccountId_day_key" ON "InstagramFollowersDaily"("instagramAccountId", "day");

-- AddForeignKey
ALTER TABLE "InstagramFollowersDaily" ADD CONSTRAINT "InstagramFollowersDaily_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
