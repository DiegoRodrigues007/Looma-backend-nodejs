// src/infrastructure/db/PrismaInstagramTokenStore.ts
import type {
  IInstagramTokenStore,
  InstagramTokenRecord,
  SaveOrUpdateInstagramTokenInput,
} from "../../application/instagram/IInstagramTokenStore";

import { prisma } from "./prismaClient";

function cleanOptString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function hasOwn<T extends object>(obj: T, key: keyof any): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export class PrismaInstagramTokenStore implements IInstagramTokenStore {
  /**
   * Pega a conta IG mais recente do usuário (fallback).
   * (Se você quiser usar "conta ativa", o ideal é receber activeInstagramAccountId aqui
   *  ou ter um método getActiveByUserId.)
   */
  async getByUserId(userId: string): Promise<InstagramTokenRecord | null> {
    if (!userId) return null;

    const row = await prisma.instagramAccount.findFirst({
      where: { userId, isConnected: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!row?.igUserId) return null;
    if (!row.accessToken && !row.pageAccessToken) return null;

    return {
      userId: row.userId,
      igUserId: row.igUserId,
      accessToken: row.accessToken ?? "",
      pageAccessToken: row.pageAccessToken ?? null,
      facebookPageId: row.facebookPageId ?? null,
      username: row.username ?? null,
      accountType: row.accountType ?? null,
      expiresAt: row.expiresAt ?? null,
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

    // exige pelo menos um token (igual você já fazia)
    if (!accessTokenClean && !pageAccessTokenClean) {
      throw new Error(
        "accessToken ou pageAccessToken é obrigatório para salvar token do Instagram"
      );
    }

    const usernameClean = cleanOptString(username);
    const accountTypeClean = cleanOptString(accountType);
    const facebookPageIdClean = cleanOptString(facebookPageId);
    const grantedScopesClean = cleanOptString(grantedScopes);

    /**
     * ✅ Update data:
     * - Não zera accessToken se não vier um novo
     * - pageAccessToken: permite limpar pra null quando vier explicitamente
     */
    const updateData: Record<string, any> = {
      username: usernameClean,
      accountType: accountTypeClean,
      facebookPageId: facebookPageIdClean,
      expiresAt: expiresAt ?? null,
      lastRefreshedAt: lastRefreshedAt ?? null,
      ...(grantedScopesClean ? { grantedScopes: grantedScopesClean } : {}),
      ...(typeof isConnected === "boolean" ? { isConnected } : {}),
    };

    // só atualiza accessToken se vier (não overwrite acidental)
    if (accessTokenClean) {
      updateData.accessToken = accessTokenClean;
    }

    // pageAccessToken: se o campo existir no input, permite setar null (limpar)
    if (hasOwn(input as any, "pageAccessToken")) {
      updateData.pageAccessToken = pageAccessTokenClean;
    } else if (pageAccessTokenClean) {
      // fallback: se veio valor, seta
      updateData.pageAccessToken = pageAccessTokenClean;
    }

    /**
     * ✅ Upsert usando unique composto do schema:
     * @@unique([userId, igUserId], name: "userId_igUserId")
     *
     * No Prisma Client, isso vira: where: { userId_igUserId: { userId, igUserId } }
     */
    await prisma.instagramAccount.upsert({
      where: {
        userId_igUserId: {
          userId,
          igUserId,
        },
      },
      update: updateData,
      create: {
        userId,
        igUserId,
        username: usernameClean,
        accountType: accountTypeClean,
        facebookPageId: facebookPageIdClean,
        expiresAt: expiresAt ?? null,
        lastRefreshedAt: lastRefreshedAt ?? null,
        grantedScopes: grantedScopesClean,
        accessToken: accessTokenClean,
        pageAccessToken: pageAccessTokenClean,
        isConnected: typeof isConnected === "boolean" ? isConnected : true,
      },
    });
  }
}
