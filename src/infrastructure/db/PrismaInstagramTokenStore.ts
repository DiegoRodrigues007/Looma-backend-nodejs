import { PrismaClient } from "@prisma/client";
import type {
  IInstagramTokenStore,
  InstagramTokenRecord,
  SaveOrUpdateInstagramTokenInput,
} from "../../application/instagram/IInstagramTokenStore";

const prisma = new PrismaClient();

export class PrismaInstagramTokenStore implements IInstagramTokenStore {
  async getByUserId(userId: string): Promise<InstagramTokenRecord | null> {
    if (!userId) return null;

    const row = await prisma.instagramAccount.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    if (!row?.instagramId || (!row.accessToken && !row.pageAccessToken)) return null;

    return {
      userId: row.userId ?? "",
      igUserId: row.instagramId,
      accessToken: row.accessToken ?? "",
      pageAccessToken: row.pageAccessToken ?? null,
      facebookPageId: row.facebookPageId ?? null,
      username: row.instagramUserName ?? null,
      accountType: null, 
      expiresAt: row.accessTokenExpiresAt ?? null,
      lastRefreshedAt: row.lastRefreshedAt ?? null,
    };
  }

  async saveOrUpdate(input: SaveOrUpdateInstagramTokenInput): Promise<void> {
    const {
      userId,
      igUserId,
      username,
      accessToken,
      pageAccessToken,
      facebookPageId,
      expiresAt,
      lastRefreshedAt,
    } = input;

    if (!userId) throw new Error("userId é obrigatório para salvar token do Instagram");
    if (!igUserId) throw new Error("igUserId é obrigatório para salvar token do Instagram");
    if (!accessToken && !pageAccessToken) {
      throw new Error("accessToken ou pageAccessToken é obrigatório para salvar token do Instagram");
    }

    await prisma.instagramAccount.upsert({
      where: { instagramId: igUserId },
      update: {
        userId,

        instagramUserName: username ?? null,

        ...(typeof accessToken === "string" && accessToken.trim().length > 0
          ? { accessToken: accessToken.trim() }
          : {}),

        pageAccessToken:
          typeof pageAccessToken === "string" && pageAccessToken.trim().length > 0
            ? pageAccessToken.trim()
            : null,

        facebookPageId: facebookPageId ?? null,
        accessTokenExpiresAt: expiresAt ?? null,
        lastRefreshedAt: lastRefreshedAt ?? null,
      },
      create: {
        userId,
        instagramId: igUserId,
        instagramUserName: username ?? null,

        accessToken:
          typeof accessToken === "string" && accessToken.trim().length > 0
            ? accessToken.trim()
            : null,

        pageAccessToken:
          typeof pageAccessToken === "string" && pageAccessToken.trim().length > 0
            ? pageAccessToken.trim()
            : null,

        facebookPageId: facebookPageId ?? null,
        accessTokenExpiresAt: expiresAt ?? null,
        lastRefreshedAt: lastRefreshedAt ?? null,
      },
    });
  }
}
