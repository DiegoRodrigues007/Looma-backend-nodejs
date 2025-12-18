import { PrismaClient } from "@prisma/client";
import {
  IInstagramTokenStore,
  InstagramTokenRecord,
  InstagramTokenUpsert
} from "../../application/instagram/IInstagramTokenStore";

const prisma = new PrismaClient();

export class PrismaInstagramTokenStore implements IInstagramTokenStore {
  async get(igUserId: string): Promise<InstagramTokenRecord | null> {
    const row = await prisma.instagramAccount.findUnique({
      where: { instagramId: igUserId }
    });

    // não achou
    if (!row) return null;

    // proteção extra caso seu schema permita instagramId null
    if (!row.instagramId) return null;

    return {
      igUserId: row.instagramId, // ✅ agora sempre string
      accessToken: row.accessToken ?? "",
      expiresAt: row.accessTokenExpiresAt ?? null,

      // extras (se existirem no schema)
      username: (row as any).instagramUserName ?? null,
      accountType: (row as any).accountType ?? null,
      facebookPageId: (row as any).facebookPageId ?? null,
      pageAccessToken: (row as any).pageAccessToken ?? null,
      lastRefreshedAt: (row as any).lastRefreshedAt ?? null
    };
  }

  async saveOrUpdate(data: InstagramTokenUpsert): Promise<void> {
    const {
      igUserId,
      username,
      accountType,
      accessToken,
      expiresAt,
      facebookPageId,
      pageAccessToken,
      lastRefreshedAt
    } = data;

    if (!igUserId) {
      throw new Error("igUserId é obrigatório para salvar token do Instagram");
    }

    await prisma.instagramAccount.upsert({
      where: { instagramId: igUserId },
      create: {
        instagramId: igUserId,
        accessToken,
        accessTokenExpiresAt: expiresAt ?? null,

        ...(facebookPageId !== undefined ? { facebookPageId } : {}),
        ...(pageAccessToken !== undefined ? { pageAccessToken } : {}),
        ...(username !== undefined ? { instagramUserName: username } : {}),
        ...(accountType !== undefined ? { accountType } : {}),
        ...(lastRefreshedAt !== undefined ? { lastRefreshedAt } : {})
      } as any,
      update: {
        accessToken,
        accessTokenExpiresAt: expiresAt ?? null,

        ...(facebookPageId !== undefined ? { facebookPageId } : {}),
        ...(pageAccessToken !== undefined ? { pageAccessToken } : {}),
        ...(username !== undefined ? { instagramUserName: username } : {}),
        ...(accountType !== undefined ? { accountType } : {}),
        ...(lastRefreshedAt !== undefined ? { lastRefreshedAt } : {})
      } as any
    });
  }
}
