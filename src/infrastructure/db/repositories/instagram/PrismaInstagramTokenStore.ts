import type {
  IInstagramTokenStore,
  InstagramTokenRecord,
  SaveOrUpdateInstagramTokenInput,
} from "../../../../application/interfaces/instagram/IInstagramTokenStore";

import { prisma } from "../../prismaClient";

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
  async getByUserId(userId: string): Promise<InstagramTokenRecord | null> {
    const uid = cleanOptString(userId);
    if (!uid) return null;

    const row = await prisma.instagramAccount.findFirst({
      where: { userId: uid, isConnected: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!row?.igUserId) return null;

    const hasToken =
      !!cleanOptString(row.accessToken) || !!cleanOptString(row.pageAccessToken);
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

    if (!userId) throw new Error("userId é obrigatório para salvar token do Instagram");
    if (!igUserId) throw new Error("igUserId é obrigatório para salvar token do Instagram");

    const accessTokenClean = cleanOptString((input as any).accessToken);
    const pageAccessTokenClean = cleanOptString((input as any).pageAccessToken);

    if (!accessTokenClean && !pageAccessTokenClean) {
      throw new Error(
        "accessToken ou pageAccessToken é obrigatório para salvar token do Instagram"
      );
    }

    const usernameClean = cleanOptString((input as any).username);
    const accountTypeClean = cleanOptString((input as any).accountType);
    const facebookPageIdClean = cleanOptString((input as any).facebookPageId);
    const grantedScopesClean = cleanOptString((input as any).grantedScopes);

    const isConnectedBool = safeBool((input as any).isConnected);
    if (typeof isConnectedBool !== "boolean") {
      throw new Error("isConnected é obrigatório para salvar token do Instagram");
    }

    const updateData: Record<string, any> = {};

    if (hasOwn(input as any, "username")) updateData.username = usernameClean;
    if (hasOwn(input as any, "accountType")) updateData.accountType = accountTypeClean;
    if (hasOwn(input as any, "facebookPageId")) updateData.facebookPageId = facebookPageIdClean;
    if (hasOwn(input as any, "grantedScopes")) updateData.grantedScopes = grantedScopesClean;

    if (hasOwn(input as any, "expiresAt")) updateData.expiresAt = (input as any).expiresAt ?? null;
    if (hasOwn(input as any, "lastRefreshedAt"))
      updateData.lastRefreshedAt = (input as any).lastRefreshedAt ?? null;

    updateData.isConnected = isConnectedBool;

    if (accessTokenClean) updateData.accessToken = accessTokenClean;

    if (hasOwn(input as any, "pageAccessToken")) {
      updateData.pageAccessToken = pageAccessTokenClean;
    } else if (pageAccessTokenClean) {
      updateData.pageAccessToken = pageAccessTokenClean;
    }

    const createData: Record<string, any> = {
      userId,
      igUserId,
      isConnected: isConnectedBool,
      accessToken: accessTokenClean ?? "", 
      pageAccessToken: pageAccessTokenClean,
      ...(grantedScopesClean ? { grantedScopes: grantedScopesClean } : {}),
    };

    if (hasOwn(input as any, "username")) createData.username = usernameClean;
    if (hasOwn(input as any, "accountType")) createData.accountType = accountTypeClean;
    if (hasOwn(input as any, "facebookPageId")) createData.facebookPageId = facebookPageIdClean;

    if (hasOwn(input as any, "expiresAt")) createData.expiresAt = (input as any).expiresAt ?? null;
    if (hasOwn(input as any, "lastRefreshedAt"))
      createData.lastRefreshedAt = (input as any).lastRefreshedAt ?? null;

    await prisma.instagramAccount.upsert({
      where: {
        userId_igUserId: { userId, igUserId },
      },
      update: updateData,
      create: createData as any,
    });
  }
}