/*
  Warnings:

  - You are about to drop the `InstagramToken` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "InstagramToken" DROP CONSTRAINT "InstagramToken_userId_fkey";

-- DropTable
DROP TABLE "InstagramToken";

-- CreateTable
CREATE TABLE "InstagramAccounts" (
    "Id" TEXT NOT NULL,
    "OwnerUserId" TEXT,
    "InstagramId" TEXT,
    "InstagramUserName" TEXT,
    "FacebookPageId" TEXT,
    "AccessToken" TEXT,
    "PageAccessToken" TEXT,
    "AccessTokenExpiresAt" TIMESTAMP(3),
    "GrantedScopes" TEXT,
    "LastRefreshedAt" TIMESTAMP(3),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP(3) NOT NULL,
    "UserId" TEXT,

    CONSTRAINT "InstagramAccounts_pkey" PRIMARY KEY ("Id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccounts_InstagramId_key" ON "InstagramAccounts"("InstagramId");

-- CreateIndex
CREATE INDEX "InstagramAccounts_UserId_idx" ON "InstagramAccounts"("UserId");

-- AddForeignKey
ALTER TABLE "InstagramAccounts" ADD CONSTRAINT "InstagramAccounts_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
