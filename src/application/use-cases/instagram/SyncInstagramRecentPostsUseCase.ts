// src/application/use-cases/instagram/SyncInstagramRecentPostsUseCase.ts
import axios from "axios";
import { prisma } from "../../../infrastructure/db/prismaClient";

function s(v: any): string {
  return String(v ?? "").trim();
}

type IgMediaItem = {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  thumbnail_url?: string;
};

type IgMediaResponse = {
  data?: IgMediaItem[];
};

export type SyncRecentPostsParams = {
  userId: string;
  instagramAccountId?: string | null;
  limit?: number; // default 20
  deleteOldBeyondLimit?: boolean; // default true
};

export type SyncRecentPostsResult = {
  ok: true;
  instagramAccountIdUsed: string;
  fetched: number;
  upserted: number;
  deletedOld: number;
};

export class SyncInstagramRecentPostsUseCase {
  // ✅ respeita .env / .env.test
  // Ex.: em testes => http://127.0.0.1:4111
  private readonly graphBaseUrl = (
    process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0"
  ).replace(/\/+$/, "");

  async execute(params: SyncRecentPostsParams): Promise<SyncRecentPostsResult> {
    const userId = s(params.userId);
    if (!userId) throw new Error("userId é obrigatório");

    const limit = Math.max(1, Math.min(50, Number(params.limit ?? 20) || 20));
    const deleteOldBeyondLimit = params.deleteOldBeyondLimit ?? true;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeInstagramAccountId: true },
    });

    const desiredAccountId =
      s(params.instagramAccountId ?? "") ||
      s(user?.activeInstagramAccountId ?? "");

    const account =
      (desiredAccountId
        ? await prisma.instagramAccount.findFirst({
            where: { id: desiredAccountId, userId, isConnected: true },
            orderBy: { updatedAt: "desc" },
          })
        : null) ||
      (await prisma.instagramAccount.findFirst({
        where: { userId, isConnected: true },
        orderBy: { updatedAt: "desc" },
      }));

    if (!account) {
      throw new Error("Conta do Instagram não encontrada");
    }

    const instagramAccountIdUsed = account.id;

    const igUserId = s((account as any)?.igUserId);

    // 🔑 AJUSTE IMPORTANTE:
    // Em produção usamos pageAccessToken
    // Em testes (ou contas antigas), usamos accessToken como fallback
    const pageAccessToken =
      s((account as any)?.pageAccessToken) || s((account as any)?.accessToken);

    if (!igUserId || !pageAccessToken) {
      throw new Error("Conta IG sem igUserId/token válido. Refaça a conexão.");
    }

    // ✅ Graph API: últimos posts
    const fields =
      "id,caption,media_type,media_url,permalink,timestamp,thumbnail_url";

    // ✅ base configurável (fake server em testes)
    // /{igUserId}/media
    const url = `${this.graphBaseUrl}/${encodeURIComponent(igUserId)}/media`;

    const r = await axios.get(url, {
      params: {
        fields,
        limit,
        access_token: pageAccessToken,
      },
      timeout: 15000,
    });

    const body = r.data as IgMediaResponse;
    const items = Array.isArray(body?.data) ? body.data : [];

    if (items.length === 0) {
      return {
        ok: true,
        instagramAccountIdUsed,
        fetched: 0,
        upserted: 0,
        deletedOld: 0,
      };
    }

    let upserted = 0;

    for (const it of items) {
      const igMediaId = s(it.id);
      if (!igMediaId) continue;

      const publishedAt =
        it.timestamp && !Number.isNaN(new Date(it.timestamp).getTime())
          ? new Date(it.timestamp)
          : new Date();

      const thumb = s(it.thumbnail_url) || s(it.media_url) || null;

      await prisma.instagramPost.upsert({
        where: {
          instagramAccountId_igMediaId: {
            instagramAccountId: instagramAccountIdUsed,
            igMediaId,
          },
        },
        create: {
          userId,
          instagramAccountId: instagramAccountIdUsed,
          igMediaId,
          mediaType: it.media_type ?? null,
          publishedAt,
          caption: it.caption ?? null,
          permalink: it.permalink ?? null,
          likeCount: 0,
          commentsCount: 0,
          thumb,
        },
        update: {
          mediaType: it.media_type ?? null,
          publishedAt,
          caption: it.caption ?? null,
          permalink: it.permalink ?? null,
          thumb,
        },
      });

      upserted++;
    }

    let deletedOld = 0;
    if (deleteOldBeyondLimit) {
      const keep = items.map((x) => s(x.id)).filter(Boolean);

      const del = await prisma.instagramPost.deleteMany({
        where: {
          userId,
          instagramAccountId: instagramAccountIdUsed,
          igMediaId: { notIn: keep },
        },
      });

      deletedOld = del.count ?? 0;
    }

    return {
      ok: true,
      instagramAccountIdUsed,
      fetched: items.length,
      upserted,
      deletedOld,
    };
  }
}