/*
  Warnings:

  - You are about to drop the `InstagramAccount` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "InstagramAccount" DROP CONSTRAINT "InstagramAccount_userId_fkey";

-- DropTable
DROP TABLE "InstagramAccount";

-- CreateTable
CREATE TABLE "InstagramAccounts" (
    "id" TEXT NOT NULL,
    "instagramId" TEXT NOT NULL,
    "instagramUserName" TEXT,
    "accountType" TEXT,
    "facebookPageId" TEXT,
    "accessToken" TEXT,
    "pageAccessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "grantedScopes" TEXT,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "InstagramAccounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccounts_instagramId_key" ON "InstagramAccounts"("instagramId");

-- CreateIndex
CREATE INDEX "InstagramAccounts_userId_idx" ON "InstagramAccounts"("userId");

-- AddForeignKey
ALTER TABLE "InstagramAccounts" ADD CONSTRAINT "InstagramAccounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
