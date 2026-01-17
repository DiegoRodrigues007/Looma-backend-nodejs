-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeInstagramAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeInstagramAccountId_fkey" FOREIGN KEY ("activeInstagramAccountId") REFERENCES "InstagramAccounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
