/*
  Warnings:

  - You are about to drop the column `OwnerUserId` on the `InstagramAccounts` table. All the data in the column will be lost.
  - Made the column `InstagramId` on table `InstagramAccounts` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "InstagramAccounts" DROP COLUMN "OwnerUserId",
ADD COLUMN     "AccountType" TEXT,
ALTER COLUMN "InstagramId" SET NOT NULL;
