import { PrismaClient } from "@prisma/client";
import {
  IInstagramTokenStore,
  InstagramTokenRecord
} from "../../application/instagram/IInstagramTokenStore";

const prisma = new PrismaClient();

export class PrismaInstagramTokenStore implements IInstagramTokenStore {
  async get(igUserId: string): Promise<InstagramTokenRecord | null> {
    const row = await prisma.instagramToken.findUnique({
      where: { igUserId }
    });

    if (!row) return null;

    return {
      accessToken: row.accessToken,
      expiresAt: row.expiresAt ?? undefined
    };
  }

  async saveOrUpdate(
    igUserId: string,
    accessToken: string,
    expiresAt?: Date | null
  ): Promise<void> {
    await prisma.instagramToken.upsert({
      where: { igUserId },
      create: {
        igUserId,
        accessToken,
        expiresAt: expiresAt ?? null
      },
      update: {
        accessToken,
        expiresAt: expiresAt ?? null
      }
    });
  }
}
