/*
  Warnings:

  - A unique constraint covering the columns `[userId,selectionId,igUserId,facebookPageId]` on the table `InstagramCandidates` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "InstagramCandidates_userId_selectionId_key";

-- CreateIndex
CREATE UNIQUE INDEX "InstagramCandidates_userId_selectionId_igUserId_facebookPag_key" ON "InstagramCandidates"("userId", "selectionId", "igUserId", "facebookPageId");
