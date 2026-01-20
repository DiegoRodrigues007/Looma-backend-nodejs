-- CreateTable
CREATE TABLE "InstagramProfileViewsDaily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramProfileViewsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstagramProfileViewsDaily_userId_instagramAccountId_day_idx" ON "InstagramProfileViewsDaily"("userId", "instagramAccountId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramProfileViewsDaily_instagramAccountId_day_key" ON "InstagramProfileViewsDaily"("instagramAccountId", "day");

-- AddForeignKey
ALTER TABLE "InstagramProfileViewsDaily" ADD CONSTRAINT "InstagramProfileViewsDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramProfileViewsDaily" ADD CONSTRAINT "InstagramProfileViewsDaily_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
