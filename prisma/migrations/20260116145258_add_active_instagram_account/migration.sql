/*
  Warnings:

  - You are about to drop the column `activeInstagramAccountId` on the `User` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_activeInstagramAccountId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "activeInstagramAccountId";
