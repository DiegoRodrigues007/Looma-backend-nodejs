// src/application/services/analytics/ensurePostsAndMetricsInRange.ts

import { prisma } from "../../../infrastructure/db/prismaClient";
import { AxiosInstagramGraphClient } from "../../../infrastructure/instagram/clients/AxiosInstagramGraphClient";

function s(v: any): string {
  return String(v ?? "").trim();
}

function safeNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function safeInt(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// ✅ converte null/NaN em undefined (pra não mandar campo pro Prisma)
function optionalNumber(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseYmdToUtcStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function parseYmdToUtcEnd(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999Z`);
}

// ✅ timestamp pode vir Date ou string
function toDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d : null;
}

// ✅ lê campos camelCase OU snake_case
function getLikes(m: any): number {
  return safeNum(m?.likeCount ?? m?.like_count ?? m?.likes ?? 0);
}

function getComments(m: any): number {
  return safeNum(m?.commentsCount ?? m?.comments_count ?? m?.comments ?? 0);
}

function getMediaType(m: any): string | null {
  return (m?.mediaType ?? m?.media_type ?? null) as any;
}

function getThumb(m: any): string | null {
  return s(m?.thumbnailUrl ?? m?.thumbnail_url) || s(m?.mediaUrl ?? m?.media_url) || null;
}

/**
 * ✅ tenta buscar insights por mídia (saved/shares/plays/video_views)
 * - suporta diferentes formatos de retorno do client
 * - se o client não implementar, retorna {} sem quebrar
 */
async function getMediaInsightsSafe(
  igClient: any,
  mediaId: string,
  accessToken: string
): Promise<{
  saves?: number;
  shares?: number;
  plays?: number;
  videoViews?: number;
}> {
  try {
    // Opção A: método genérico
    if (typeof igClient.getMediaInsights === "function") {
      const resp = await igClient.getMediaInsights({
        mediaId,
        accessToken,
        metrics: ["saved", "shares", "plays", "video_views"],
        timeoutMs: 15000,
      });

      // Formato 1: { saves, shares, plays, videoViews }
      const directSaves = resp?.saves ?? resp?.saved ?? resp?.data?.saves ?? resp?.data?.saved;
      const directShares = resp?.shares ?? resp?.data?.shares;
      const directPlays = resp?.plays ?? resp?.data?.plays;
      const directVideoViews =
        resp?.videoViews ?? resp?.video_views ?? resp?.data?.videoViews ?? resp?.data?.video_views;

      // se tiver algo direto
      if (
        directSaves != null ||
        directShares != null ||
        directPlays != null ||
        directVideoViews != null
      ) {
        return {
          saves: directSaves != null ? safeInt(directSaves) : undefined,
          shares: directShares != null ? safeInt(directShares) : undefined,
          plays: directPlays != null ? safeInt(directPlays) : undefined,
          videoViews: directVideoViews != null ? safeInt(directVideoViews) : undefined,
        };
      }

      // Formato 2: { data: [{name, total_value/value/values...}] }
      const arr = Array.isArray(resp?.data) ? resp.data : [];
      const map = new Map<string, number>();

      for (const it of arr) {
        const name = String(it?.name ?? "").toLowerCase();
        const v =
          it?.total_value?.value ??
          it?.value ??
          (Array.isArray(it?.values) ? it?.values?.[0]?.value : undefined) ??
          0;

        map.set(name, safeInt(v));
      }

      return {
        saves: map.get("saved"),
        shares: map.get("shares"),
        plays: map.get("plays"),
        videoViews: map.get("video_views"),
      };
    }

    // Opção B: métodos específicos (se existir no seu client)
    if (typeof igClient.getMediaSavedShares === "function") {
      const resp = await igClient.getMediaSavedShares({
        mediaId,
        accessToken,
        timeoutMs: 15000,
      });
      return {
        saves: resp?.saves != null ? safeInt(resp.saves) : resp?.saved != null ? safeInt(resp.saved) : undefined,
        shares: resp?.shares != null ? safeInt(resp.shares) : undefined,
      };
    }

    return {};
  } catch {
    return {};
  }
}

export type EnsureRangeProgress = {
  importedPosts: number;
  processedMetrics: number;
};

export type EnsurePostsAndMetricsInRangeInput = {
  userId: string;
  instagramAccountId: string;
  igUserId: string;
  accessToken: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  maxPosts?: number;
  onProgress?: (p: EnsureRangeProgress) => Promise<void> | void;
};

export async function ensurePostsAndMetricsInRange(
  opts: EnsurePostsAndMetricsInRangeInput
): Promise<{ ensuredPosts: number; ensuredMetrics: number }> {
  const { userId, instagramAccountId, igUserId, accessToken, from, to, onProgress } = opts;

  const maxPosts = Math.max(50, Math.min(800, Number(opts.maxPosts ?? 500) || 500));

  const fromMs = parseYmdToUtcStart(from).getTime();
  const toMs = parseYmdToUtcEnd(to).getTime();

  const igClient = new AxiosInstagramGraphClient();

  // =========================
  // 1) Buscar mídias paginadas no IG
  // =========================
  const items: any[] = [];
  let after: string | undefined;
  let pages = 0;
  const maxPages = 25;

  while (pages < maxPages && items.length < maxPosts) {
    pages++;

    const out = await igClient.getRecentMediaPaged({
      igUserId,
      accessToken,
      limit: 50,
      after,
      timeoutMs: 15000,
    });

    const rows = Array.isArray(out?.data) ? out.data : [];
    if (!rows.length) break;

    let shouldStop = false;

    for (const m of rows) {
      const publishedAt = toDate(m?.timestamp);
      if (!publishedAt) continue;

      const tsMs = publishedAt.getTime();

      // se passou do range inferior, para (feed está em ordem desc)
      if (tsMs < fromMs) {
        shouldStop = true;
        break;
      }

      // filtra range
      if (tsMs < fromMs || tsMs > toMs) continue;

      // garante timestamp como Date pra todo o fluxo
      items.push({ ...m, timestamp: publishedAt });

      if (items.length >= maxPosts) break;
    }

    const nextAfter = out?.paging?.cursors?.after;
    if (!nextAfter || shouldStop) break;
    after = nextAfter;
  }

  if (!items.length) {
    await onProgress?.({ importedPosts: 0, processedMetrics: 0 });
    return { ensuredPosts: 0, ensuredMetrics: 0 };
  }

  // =========================
  // 2) Upsert posts (DB)
  // =========================
  let importedPosts = 0;

  for (const it of items) {
    const igMediaId = s(it?.id);
    if (!igMediaId) continue;

    const publishedAt = it.timestamp instanceof Date ? it.timestamp : toDate(it.timestamp);
    if (!publishedAt) continue;

    const thumb = getThumb(it);

    await prisma.instagramPost.upsert({
      where: { instagramAccountId_igMediaId: { instagramAccountId, igMediaId } },
      create: {
        userId,
        instagramAccountId,
        igMediaId,
        mediaType: getMediaType(it),
        publishedAt,
        caption: it.caption ?? null,
        permalink: it.permalink ?? null,
        likeCount: safeInt(getLikes(it)),
        commentsCount: safeInt(getComments(it)),
        thumb,
      },
      update: {
        mediaType: getMediaType(it),
        publishedAt,
        caption: it.caption ?? null,
        permalink: it.permalink ?? null,
        likeCount: safeInt(getLikes(it)),
        commentsCount: safeInt(getComments(it)),
        thumb,
      },
    });

    importedPosts++;
    if (importedPosts % 25 === 0) {
      await onProgress?.({ importedPosts, processedMetrics: 0 });
    }
  }

  await onProgress?.({ importedPosts, processedMetrics: 0 });

  // =========================
  // 3) Buscar posts no DB dentro do range
  // =========================
  const dbPosts = await prisma.instagramPost.findMany({
    where: {
      userId,
      instagramAccountId,
      publishedAt: {
        gte: parseYmdToUtcStart(from),
        lte: parseYmdToUtcEnd(to),
      },
    },
    select: {
      id: true,
      igMediaId: true,
      likeCount: true,
      commentsCount: true,
      metrics: {
        orderBy: { pulledAt: "desc" },
        take: 1,
        select: { pulledAt: true },
      },
    },
  });

  // map do que veio do IG (pra fallback)
  const byIgId = new Map(items.map((m) => [s(m?.id), m]));

  // pega posts que precisam atualizar (mais de 24h sem métrica)
  const toFetch = dbPosts.filter((p) => {
    const last = p.metrics?.[0]?.pulledAt;
    if (!last) return true;
    return Date.now() - new Date(last).getTime() > 24 * 60 * 60 * 1000;
  });

  // =========================
  // 4) Criar métricas por post (reach + insights)
  // =========================
  let ensuredMetrics = 0;

  // concurrency 2
  let idx = 0;
  const workers = Array.from({ length: Math.min(2, toFetch.length) }, async () => {
    while (idx < toFetch.length) {
      const cur = toFetch[idx++];
      const igMediaId = s(cur.igMediaId);
      if (!igMediaId) continue;

      try {
        const reach = await igClient.getMediaReach({
          mediaId: igMediaId,
          accessToken,
          timeoutMs: 15000,
        });

        const m = byIgId.get(igMediaId);

        // ✅ likes/comments corretos (camelCase + fallback)
        const likes = safeInt(m ? getLikes(m) : cur.likeCount);
        const comments = safeInt(m ? getComments(m) : cur.commentsCount);

        // ✅ insights (saves/shares/plays/videoViews) — pode vir vazio
        const insights = await getMediaInsightsSafe(igClient as any, igMediaId, accessToken);

        const saves = safeInt(insights.saves ?? 0);
        const shares = safeInt(insights.shares ?? 0);

        const plays = optionalNumber(insights.plays);
        const videoViews = optionalNumber(insights.videoViews);

        const totalInteractions = safeInt(likes + comments + shares + saves);

        await prisma.instagramPostMetric.create({
          data: {
            postId: cur.id,
            pulledAt: new Date(),

            reach: safeInt(reach),
            likes,
            comments,
            shares,
            saves,

            plays,
            videoViews,

            totalInteractions,
          },
        });

        ensuredMetrics++;

        if (ensuredMetrics % 10 === 0) {
          await onProgress?.({ importedPosts, processedMetrics: ensuredMetrics });
        }
      } catch {
        // ignora: não quebra o job
      }
    }
  });

  await Promise.all(workers);

  await onProgress?.({ importedPosts, processedMetrics: ensuredMetrics });

  return { ensuredPosts: importedPosts, ensuredMetrics };
}
