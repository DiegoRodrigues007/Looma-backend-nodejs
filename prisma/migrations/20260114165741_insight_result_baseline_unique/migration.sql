/*
  Warnings:

  - A unique constraint covering the columns `[postId,baselineWindowDays]` on the table `InstagramPostInsightResults` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "InstagramPostInsightResults_postId_key";

-- CreateIndex
CREATE INDEX "InstagramPostInsightResults_postId_baselineWindowDays_idx" ON "InstagramPostInsightResults"("postId", "baselineWindowDays");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramPostInsightResults_postId_baselineWindowDays_key" ON "InstagramPostInsightResults"("postId", "baselineWindowDays");
