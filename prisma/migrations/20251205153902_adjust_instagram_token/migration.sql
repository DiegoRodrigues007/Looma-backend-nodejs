-- DropForeignKey
ALTER TABLE "InstagramToken" DROP CONSTRAINT "InstagramToken_userId_fkey";

-- AlterTable
ALTER TABLE "InstagramToken" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "InstagramToken_userId_idx" ON "InstagramToken"("userId");

-- AddForeignKey
ALTER TABLE "InstagramToken" ADD CONSTRAINT "InstagramToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
