-- AlterTable
ALTER TABLE "MetricsSnapshots" ALTER COLUMN "date" SET DATA TYPE DATE,
ALTER COLUMN "followers" SET DEFAULT 0,
ALTER COLUMN "reach" SET DEFAULT 0,
ALTER COLUMN "totalInteractions" SET DEFAULT 0,
ALTER COLUMN "engagementRate" SET DEFAULT 0;

-- AddForeignKey
ALTER TABLE "MetricsSnapshots" ADD CONSTRAINT "MetricsSnapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
