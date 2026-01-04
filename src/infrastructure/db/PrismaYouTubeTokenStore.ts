import { PrismaClient } from "@prisma/client";
import type {
  IYouTubeTokenStore,
  SaveOrUpdateYouTubeTokenInput,
  YouTubeTokenRecord,
} from "../../application/youtube/IYouTubeTokenStore";

const prisma = new PrismaClient();

export class PrismaYouTubeTokenStore implements IYouTubeTokenStore {
  async getByUserId(userId: string): Promise<YouTubeTokenRecord | null> {
    if (!userId) return null;

    const row = await prisma.youTubeAccount.findFirst({
      where: { userId, isConnected: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!row?.channelId) return null;

    return {
      userId: row.userId,
      channelId: row.channelId,
      accessToken: row.accessToken ?? null,
      refreshToken: row.refreshToken ?? null,
      expiresAt: row.expiresAt ?? null,
      grantedScopes: row.grantedScopes ?? null,
      lastRefreshedAt: row.lastRefreshedAt ?? null,
    };
  }

  async saveOrUpdate(input: SaveOrUpdateYouTubeTokenInput): Promise<void> {
    const {
      userId,
      channelId,
      channelTitle,
      channelHandle,
      accessToken,
      refreshToken,
      expiresAt,
      grantedScopes,
      lastRefreshedAt,
      isConnected,
    } = input;

    if (!userId) throw new Error("userId é obrigatório");
    if (!channelId) throw new Error("channelId é obrigatório");

    await prisma.youTubeAccount.upsert({
      where: { channelId },
      update: {
        userId,
        channelTitle: channelTitle ?? null,
        channelHandle: channelHandle ?? null,

        ...(typeof accessToken === "string" && accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
        ...(typeof refreshToken === "string" && refreshToken.trim()
          ? { refreshToken: refreshToken.trim() }
          : {}),

        expiresAt: expiresAt ?? null,
        grantedScopes: grantedScopes ?? null,
        lastRefreshedAt: lastRefreshedAt ?? null,
        ...(typeof isConnected === "boolean" ? { isConnected } : {}),
      },
      create: {
        userId,
        channelId,
        channelTitle: channelTitle ?? null,
        channelHandle: channelHandle ?? null,
        accessToken: typeof accessToken === "string" && accessToken.trim() ? accessToken.trim() : null,
        refreshToken: typeof refreshToken === "string" && refreshToken.trim() ? refreshToken.trim() : null,
        expiresAt: expiresAt ?? null,
        grantedScopes: grantedScopes ?? null,
        lastRefreshedAt: lastRefreshedAt ?? null,
        isConnected: typeof isConnected === "boolean" ? isConnected : true,
      },
    });
  }

  async disconnect(userId: string): Promise<void> {
    if (!userId) return;

    await prisma.youTubeAccount.updateMany({
      where: { userId, isConnected: true },
      data: {
        isConnected: false,
        accessToken: null,
        expiresAt: null,
        lastRefreshedAt: new Date(),
      },
    });
  }
}
