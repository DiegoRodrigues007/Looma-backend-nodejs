// src/infrastructure/db/PrismaInstagramTokenStore.ts
import type {
  IInstagramTokenStore,
  InstagramTokenRecord,
  SaveOrUpdateInstagramTokenInput,
} from "../../application/instagram/IInstagramTokenStore";

// ✅ usa o prisma singleton do projeto (evita múltiplas conexões)
import { prisma } from "./prismaClient";

function cleanOptString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

export class PrismaInstagramTokenStore implements IInstagramTokenStore {
  async getByUserId(userId: string): Promise<InstagramTokenRecord | null> {
    if (!userId) return null;

    const row = await prisma.instagramAccount.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    if (!row?.instagramId) return null;
    if (!row.accessToken && !row.pageAccessToken) return null;

    return {
      userId: row.userId,
      igUserId: row.instagramId,
      accessToken: row.accessToken ?? "",
      pageAccessToken: row.pageAccessToken ?? null,
      facebookPageId: row.facebookPageId ?? null,
      username: row.instagramUserName ?? null,
      accountType: row.accountType ?? null,
      expiresAt: row.accessTokenExpiresAt ?? null,
      lastRefreshedAt: row.lastRefreshedAt ?? null,
      isConnected: row.isConnected,
    };
  }

  async saveOrUpdate(input: SaveOrUpdateInstagramTokenInput): Promise<void> {
    const {
      userId,
      igUserId,
      username,
      accountType,
      accessToken,
      pageAccessToken,
      facebookPageId,
      expiresAt,
      lastRefreshedAt,
      isConnected,
      grantedScopes,
    } = input;

    if (!userId) {
      throw new Error("userId é obrigatório para salvar token do Instagram");
    }
    if (!igUserId) {
      throw new Error("igUserId é obrigatório para salvar token do Instagram");
    }

    const accessTokenClean = cleanOptString(accessToken);
    const pageAccessTokenClean = cleanOptString(pageAccessToken);

    if (!accessTokenClean && !pageAccessTokenClean) {
      throw new Error(
        "accessToken ou pageAccessToken é obrigatório para salvar token do Instagram"
      );
    }

    const usernameClean = cleanOptString(username);
    const accountTypeClean = cleanOptString(accountType);
    const facebookPageIdClean = cleanOptString(facebookPageId);
    const grantedScopesClean = cleanOptString(grantedScopes);

    // ✅ FIX: não usa upsert com unique composto (que pode não existir no Prisma Client)
    // Procura a conta mais recente do mesmo (userId, instagramId).
    const existing = await prisma.instagramAccount.findFirst({
      where: {
        userId,
        instagramId: igUserId,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    // Monta o "data" do update com cuidado para não zerar accessToken sem querer.
    const updateData: any = {
      instagramUserName: usernameClean,
      accountType: accountTypeClean,

      // ✅ se accessTokenClean for null, NÃO altera accessToken existente
      ...(accessTokenClean ? { accessToken: accessTokenClean } : {}),

      // ✅ pageAccessToken pode ser setado pra null (se quiser limpar)
      pageAccessToken: pageAccessTokenClean,

      facebookPageId: facebookPageIdClean,
      accessTokenExpiresAt: expiresAt ?? null,
      lastRefreshedAt: lastRefreshedAt ?? null,

      ...(grantedScopesClean ? { grantedScopes: grantedScopesClean } : {}),

      ...(typeof isConnected === "boolean" ? { isConnected } : {}),
    };

    if (existing?.id) {
      await prisma.instagramAccount.update({
        where: { id: existing.id },
        data: updateData,
      });
      return;
    }

    // ✅ create quando não existe registro para esse (userId, instagramId)
    await prisma.instagramAccount.create({
      data: {
        userId,
        instagramId: igUserId,

        instagramUserName: usernameClean,
        accountType: accountTypeClean,

        // aqui precisa salvar pelo menos um token
        accessToken: accessTokenClean,
        pageAccessToken: pageAccessTokenClean,

        facebookPageId: facebookPageIdClean,
        accessTokenExpiresAt: expiresAt ?? null,
        lastRefreshedAt: lastRefreshedAt ?? null,

        grantedScopes: grantedScopesClean,

        // ✅ default seguro: se não vier, marca conectado
        isConnected: typeof isConnected === "boolean" ? isConnected : true,
      },
    });
  }
}
