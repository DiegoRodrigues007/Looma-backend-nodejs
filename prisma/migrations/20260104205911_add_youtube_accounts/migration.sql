-- CreateTable
CREATE TABLE "YouTubeAccounts" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelTitle" TEXT,
    "channelHandle" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "grantedScopes" TEXT,
    "lastRefreshedAt" TIMESTAMP(3),
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "YouTubeAccounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeAccounts_channelId_key" ON "YouTubeAccounts"("channelId");

-- CreateIndex
CREATE INDEX "YouTubeAccounts_userId_idx" ON "YouTubeAccounts"("userId");

-- AddForeignKey
ALTER TABLE "YouTubeAccounts" ADD CONSTRAINT "YouTubeAccounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
