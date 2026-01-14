-- CreateTable
CREATE TABLE "InstagramPosts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "mediaType" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "caption" TEXT,
    "permalink" TEXT,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramPosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramPostMetrics" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "plays" INTEGER NOT NULL DEFAULT 0,
    "videoViews" INTEGER NOT NULL DEFAULT 0,
    "totalInteractions" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,

    CONSTRAINT "InstagramPostMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramPostInsightResults" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "baselineWindowDays" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "evidence" JSONB NOT NULL,
    "why" JSONB NOT NULL,
    "improve" JSONB NOT NULL,
    "continue" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramPostInsightResults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramBackfillJobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instagramAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "cursor" TEXT,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramBackfillJobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramPosts_igMediaId_key" ON "InstagramPosts"("igMediaId");

-- CreateIndex
CREATE INDEX "InstagramPosts_userId_publishedAt_idx" ON "InstagramPosts"("userId", "publishedAt");

-- CreateIndex
CREATE INDEX "InstagramPostMetrics_postId_pulledAt_idx" ON "InstagramPostMetrics"("postId", "pulledAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramPostInsightResults_postId_key" ON "InstagramPostInsightResults"("postId");

-- CreateIndex
CREATE INDEX "InstagramBackfillJobs_userId_status_createdAt_idx" ON "InstagramBackfillJobs"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "InstagramBackfillJobs_instagramAccountId_status_createdAt_idx" ON "InstagramBackfillJobs"("instagramAccountId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "InstagramPosts" ADD CONSTRAINT "InstagramPosts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramPostMetrics" ADD CONSTRAINT "InstagramPostMetrics_postId_fkey" FOREIGN KEY ("postId") REFERENCES "InstagramPosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramPostInsightResults" ADD CONSTRAINT "InstagramPostInsightResults_postId_fkey" FOREIGN KEY ("postId") REFERENCES "InstagramPosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramBackfillJobs" ADD CONSTRAINT "InstagramBackfillJobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramBackfillJobs" ADD CONSTRAINT "InstagramBackfillJobs_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
