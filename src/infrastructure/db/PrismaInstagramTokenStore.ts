// src/infrastructure/db/PrismaInstagramTokenStore.ts
import type {
  IInstagramTokenStore,
  InstagramTokenRecord,
  SaveOrUpdateInstagramTokenInput,
} from "../../application/instagram/IInstagramTokenStore";

import { prisma } from "./prismaClient";

function cleanOptString(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function hasOwn(obj: unknown, key: string): boolean {
  return !!obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
}

function safeBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

export class PrismaInstagramTokenStore implements IInstagramTokenStore {
  /**
   * Pega a conta IG mais recente do usuário (fallback).
   * (Se você quiser usar "conta ativa", o ideal é receber activeInstagramAccountId aqui
   *  ou ter um método getActiveByUserId.)
   */
  async getByUserId(userId: string): Promise<InstagramTokenRecord | null> {
    const uid = cleanOptString(userId);
    if (!uid) return null;

    const row = await prisma.instagramAccount.findFirst({
      where: { userId: uid, isConnected: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!row?.igUserId) return null;

    // ✅ exige pelo menos um token
    const hasToken = !!cleanOptString(row.accessToken) || !!cleanOptString(row.pageAccessToken);
    if (!hasToken) return null;

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
      grantedScopes: (row as any).grantedScopes ?? null,
    };
  }

  async saveOrUpdate(input: SaveOrUpdateInstagramTokenInput): Promise<void> {
    const userId = cleanOptString(input.userId);
    const igUserId = cleanOptString(input.igUserId);

    if (!userId) {
      throw new Error("userId é obrigatório para salvar token do Instagram");
    }
    if (!igUserId) {
      throw new Error("igUserId é obrigatório para salvar token do Instagram");
    }

    const accessTokenClean = cleanOptString(input.accessToken);
    const pageAccessTokenClean = cleanOptString(input.pageAccessToken);

    // ✅ exige pelo menos um token (igual você já fazia)
    if (!accessTokenClean && !pageAccessTokenClean) {
      throw new Error(
        "accessToken ou pageAccessToken é obrigatório para salvar token do Instagram"
      );
    }

    const usernameClean = cleanOptString(input.username);
    const accountTypeClean = cleanOptString(input.accountType);
    const facebookPageIdClean = cleanOptString(input.facebookPageId);
    const grantedScopesClean = cleanOptString((input as any).grantedScopes);

    /**
     * ✅ Update data:
     * - Não zera accessToken se não vier um novo
     * - pageAccessToken: permite limpar pra null quando vier explicitamente
     * - Mantém isConnected quando vier boolean
     */
    const updateData: Record<string, any> = {
      username: usernameClean,
      accountType: accountTypeClean,
      facebookPageId: facebookPageIdClean,
      expiresAt: input.expiresAt ?? null,
      lastRefreshedAt: input.lastRefreshedAt ?? null,
      ...(grantedScopesClean ? { grantedScopes: grantedScopesClean } : {}),
    };

    const isConnectedBool = safeBool((input as any).isConnected);
    if (typeof isConnectedBool === "boolean") {
      updateData.isConnected = isConnectedBool;
    }

    // ✅ só atualiza accessToken se vier (não overwrite acidental)
    if (accessTokenClean) {
      updateData.accessToken = accessTokenClean;
    }

    // ✅ pageAccessToken: se o campo existir no input, permite setar null (limpar)
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
        expiresAt: input.expiresAt ?? null,
        lastRefreshedAt: input.lastRefreshedAt ?? null,
        ...(grantedScopesClean ? { grantedScopes: grantedScopesClean } : {}),
        // ✅ create exige string (se seu schema não aceita null)
        accessToken: accessTokenClean ?? "",
        pageAccessToken: pageAccessTokenClean,
        isConnected: typeof isConnectedBool === "boolean" ? isConnectedBool : true,
      } as any,
    });
  }
}