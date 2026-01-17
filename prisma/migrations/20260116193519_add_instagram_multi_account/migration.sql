/*
  Warnings:

  - You are about to drop the column `accessTokenExpiresAt` on the `InstagramAccounts` table. All the data in the column will be lost.
  - You are about to drop the column `instagramId` on the `InstagramAccounts` table. All the data in the column will be lost.
  - You are about to drop the column `instagramUserName` on the `InstagramAccounts` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,igUserId]` on the table `InstagramAccounts` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `igUserId` to the `InstagramAccounts` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "InstagramAccounts_instagramId_idx";

-- DropIndex
DROP INDEX "InstagramAccounts_userId_instagramId_key";

-- AlterTable
ALTER TABLE "InstagramAccounts" DROP COLUMN "accessTokenExpiresAt",
DROP COLUMN "instagramId",
DROP COLUMN "instagramUserName",
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "igUserId" TEXT NOT NULL,
ADD COLUMN     "username" TEXT,
ALTER COLUMN "isConnected" SET DEFAULT true;

-- CreateIndex
CREATE INDEX "InstagramAccounts_igUserId_idx" ON "InstagramAccounts"("igUserId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccounts_userId_igUserId_key" ON "InstagramAccounts"("userId", "igUserId");
