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
      s(params.instagramAccountId ?? "") || s(user?.activeInstagramAccountId ?? "");

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

    if (!account) throw new Error("Conta do Instagram não encontrada");

    const instagramAccountIdUsed = account.id;

    const igUserId = s((account as any)?.igUserId);
    const pageAccessToken = s((account as any)?.pageAccessToken);

    if (!igUserId || !pageAccessToken) {
      throw new Error("Conta IG sem igUserId/pageAccessToken. Refaça a conexão.");
    }

    // Graph API: últimos posts (media)
    // OBS: vamos salvar a thumb em `thumb`:
    // - preferimos `thumbnail_url` (quando vier, geralmente em vídeos/reels)
    // - senão usamos `media_url` (imagem/capa)
    const base = `https://graph.facebook.com/v21.0/${encodeURIComponent(igUserId)}`;
    const fields =
      "id,caption,media_type,media_url,permalink,timestamp,thumbnail_url";
    const url =
      `${base}/media` +
      `?fields=${encodeURIComponent(fields)}` +
      `&limit=${limit}` +
      `&access_token=${encodeURIComponent(pageAccessToken)}`;

    const r = await axios.get(url, { timeout: 15000 });
    const body = r.data as IgMediaResponse;
    const items = Array.isArray(body?.data) ? body.data : [];

    if (items.length === 0) {
      // opcionalmente, se deleteOldBeyondLimit=true, você pode limpar tudo,
      // mas normalmente é melhor não deletar se o Graph retornou vazio.
      return {
        ok: true,
        instagramAccountIdUsed,
        fetched: 0,
        upserted: 0,
        deletedOld: 0,
      };
    }

    // Upsert dos últimos N
    let upserted = 0;

    for (const it of items) {
      const igMediaId = s(it.id);
      if (!igMediaId) continue;

      // publishedAt é obrigatório no seu schema
      const publishedAt =
        it.timestamp && !Number.isNaN(new Date(it.timestamp).getTime())
          ? new Date(it.timestamp)
          : new Date(); // fallback seguro (não deveria acontecer)

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

          // se quiser, pode manter 0 e atualizar depois com outro endpoint/job de métricas por post
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

    // manter o banco leve: apaga tudo que não estiver nesses últimos N
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
