/*
  Warnings:

  - A unique constraint covering the columns `[dedupeKey]` on the table `InstagramBackfillJobs` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `dedupeKey` to the `InstagramBackfillJobs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `from` to the `InstagramBackfillJobs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `to` to the `InstagramBackfillJobs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "InstagramAccountDailyMetrics" ALTER COLUMN "followers" DROP NOT NULL,
ALTER COLUMN "followers" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InstagramBackfillJobs" ADD COLUMN     "dedupeKey" TEXT NOT NULL,
ADD COLUMN     "from" DATE NOT NULL,
ADD COLUMN     "to" DATE NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "InstagramBackfillJobs_dedupeKey_key" ON "InstagramBackfillJobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "InstagramBackfillJobs_instagramAccountId_from_to_idx" ON "InstagramBackfillJobs"("instagramAccountId", "from", "to");
