import { PrismaClient } from "@prisma/client";
import {
  IInstagramTokenStore,
  InstagramTokenRecord
} from "../../application/instagram/IInstagramTokenStore";

const prisma = new PrismaClient();

export class PrismaInstagramTokenStore implements IInstagramTokenStore {
  async get(igUserId: string): Promise<InstagramTokenRecord | null> {
    // No seu schema Prisma, o IG user id deve estar em "instagramId"
    const row = await prisma.instagramAccount.findUnique({
      where: { instagramId: igUserId }
    });

    if (!row) return null;

    return {
      accessToken: row.accessToken ?? "",
      expiresAt: row.accessTokenExpiresAt ?? undefined
    };
  }

  async saveOrUpdate(
    igUserId: string,
    accessToken: string,
    expiresAt?: Date | null
  ): Promise<void> {
    await prisma.instagramAccount.upsert({
      where: { instagramId: igUserId },
      create: {
        instagramId: igUserId,
        accessToken,
        accessTokenExpiresAt: expiresAt ?? null
      },
      update: {
        accessToken,
        accessTokenExpiresAt: expiresAt ?? null
      }
    });
  }
}
