/*
  Warnings:

  - Changed the type of `day` on the `InstagramProfileViewsDaily` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "InstagramProfileViewsDaily" DROP COLUMN "day",
ADD COLUMN     "day" DATE NOT NULL;

-- CreateIndex
CREATE INDEX "InstagramProfileViewsDaily_userId_instagramAccountId_day_idx" ON "InstagramProfileViewsDaily"("userId", "instagramAccountId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramProfileViewsDaily_instagramAccountId_day_key" ON "InstagramProfileViewsDaily"("instagramAccountId", "day");
