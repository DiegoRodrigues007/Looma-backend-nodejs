// src/application/instagram/InstagramBackfillService.ts
import axios from "axios";
import { prisma } from "../../infrastructure/db/prismaClient";
import { InstagramPostInsightsService } from "../../infrastructure/instagram/services/InstagramPostInsightsService";

/**
 * Backfill do Instagram:
 * - pagina /{igUserId}/media (posts antigos)
 * - upsert em InstagramPost (multi-conta: instagramAccountId + igMediaId)
 * - busca insights por post (reach/saves/shares...) via InstagramPostInsightsService
 * - grava InstagramPostMetric (pulledAt = now)
 * - atualiza InstagramBackfillJob (cursor e progresso)
 *
 * ✅ Pensado pra rodar em worker (não em request).
 * ✅ Seguro (não quebra tudo por 1 post com erro).
 * ✅ Idempotente:
 *    - Post: unique composta (instagramAccountId + igMediaId)
 *    - Metric: atualiza se existir uma métrica recente (6h)
 */

type IgMediaRow = {
  id: string;
  timestamp: string; // ISO string
  caption?: string;
  media_type?: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
};

type GraphPage<T> = {
  data?: T[];
  paging?: {
    cursors?: { after?: string };
    next?: string;
  };
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toInt(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeStr(v: any): string {
  return typeof v === "string" ? v : String(v ?? "");
}

type RunParams = {
  userId: string;
  instagramAccountId?: string | null; // ✅ precisa existir (schema exige)
  igUserId: string;
  accessToken: string;
  jobId: string;

  maxPosts?: number;
  maxPages?: number;

  perPostDelayMs?: number;
  perPageDelayMs?: number;

  startAfterCursor?: string | null;

  onPostImported?: (payload: {
    userId: string;
    instagramAccountId: string | null;
    igUserId: string;
    postDbId: string;
    igMediaId: string;
  }) => Promise<void>;
};

export class InstagramBackfillService {
  private readonly graphBaseUrl =
    process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";

  private readonly postInsights = new InstagramPostInsightsService();

  async run(params: RunParams) {
    const {
      userId,
      instagramAccountId,
      igUserId,
      accessToken,
      jobId,
      startAfterCursor,
      onPostImported,
    } = params;

    // ✅ GARANTE multi-conta
    const igAccId = (instagramAccountId ?? "").trim();
    if (!igAccId) {
      const msg =
        "instagramAccountId é obrigatório para backfill (multi-conta).";
      await prisma.instagramBackfillJob.update({
        where: { id: jobId },
        data: { status: "error", lastError: msg, finishedAt: new Date() },
      });
      return {
        imported: 0,
        processed: 0,
        status: "error" as const,
        error: msg,
      };
    }

    const maxPosts = clamp(params.maxPosts ?? 300, 50, 2000);
    const maxPages = clamp(params.maxPages ?? 20, 5, 80);

    const perPostDelayMs = clamp(params.perPostDelayMs ?? 120, 0, 5000);
    const perPageDelayMs = clamp(params.perPageDelayMs ?? 150, 0, 10000);

    const fields =
      "id,caption,media_type,permalink,timestamp,like_count,comments_count";

    let after: string | undefined = startAfterCursor ?? undefined;

    let page = 0;
    let imported = 0;
    let processed = 0;

    const PROGRESS_EVERY = 10;
    let lastProgressUpdateAt = Date.now();

    await prisma.instagramBackfillJob.update({
      where: { id: jobId },
      data: {
        status: "running",
        startedAt: new Date(),
        lastError: null,
        cursor: after ?? null,
      },
    });

    while (page < maxPages && imported < maxPosts) {
      page++;

      let resp;
      try {
        resp = await axios.get<GraphPage<IgMediaRow>>(
          `${this.graphBaseUrl}/${igUserId}/media`,
          {
            params: {
              access_token: accessToken,
              fields,
              limit: 50,
              ...(after ? { after } : {}),
            },
            timeout: 25000,
            validateStatus: () => true,
          },
        );
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? "GRAPH_REQUEST_ERROR");
        await prisma.instagramBackfillJob.update({
          where: { id: jobId },
          data: { status: "error", lastError: msg, finishedAt: new Date() },
        });
        return { imported, processed, status: "error" as const, error: msg };
      }

      if (!resp || resp.status < 200 || resp.status >= 300) {
        const errMsg =
          (resp?.data as any)?.error?.message ||
          `Graph API error: status=${resp?.status ?? "unknown"}`;
        await prisma.instagramBackfillJob.update({
          where: { id: jobId },
          data: {
            status: "error",
            lastError: errMsg,
            finishedAt: new Date(),
          },
        });
        return { imported, processed, status: "error" as const, error: errMsg };
      }

      const rows = Array.isArray(resp.data?.data) ? resp.data.data : [];
      if (!rows.length) break;

      const nextAfter = resp.data?.paging?.cursors?.after;
      const nextCursor = nextAfter || undefined;

      for (const m of rows) {
        if (imported >= maxPosts) break;

        const igMediaId = safeStr(m.id).trim();
        if (!igMediaId) continue;

        const publishedAt = new Date(String(m.timestamp));
        if (Number.isNaN(publishedAt.getTime())) {
          processed++;
          continue;
        }

        const post = await prisma.instagramPost.upsert({
          where: {
            instagramAccountId_igMediaId: {
              instagramAccountId: igAccId,
              igMediaId,
            },
          },
          create: {
            userId,
            instagramAccountId: igAccId,
            igMediaId,
            mediaType: m.media_type ?? null,
            publishedAt,
            caption: m.caption ?? null,
            permalink: m.permalink ?? null,
            likeCount: toInt(m.like_count, 0),
            commentsCount: toInt(m.comments_count, 0),
          },
          update: {
            userId,
            instagramAccountId: igAccId,
            mediaType: m.media_type ?? null,
            publishedAt,
            caption: m.caption ?? null,
            permalink: m.permalink ?? null,
            likeCount: toInt(m.like_count, 0),
            commentsCount: toInt(m.comments_count, 0),
          },
        });

        imported++;

        if (onPostImported) {
          try {
            await onPostImported({
              userId,
              instagramAccountId: igAccId,
              igUserId,
              postDbId: post.id,
              igMediaId,
            });
          } catch (e: any) {
            const msg = String(e?.message ?? e ?? "ON_POST_IMPORTED_ERROR");
            await prisma.instagramBackfillJob.update({
              where: { id: jobId },
              data: { lastError: msg },
            });
          }
        }

        try {
          const withInsights = await this.postInsights.fetchPostById({
            accessToken,
            postId: igMediaId,
          });

          const reach = toInt((withInsights as any)?.reach, 0);
          const saves = toInt((withInsights as any)?.saves, 0);
          const shares = toInt((withInsights as any)?.shares, 0);

          const likes = toInt(m.like_count, 0);
          const comments = toInt(m.comments_count, 0);

          const plays = toInt((withInsights as any)?.plays, 0);
          const videoViews = toInt((withInsights as any)?.videoViews, 0);

          const totalInteractions = likes + comments + shares + saves;

          const SIX_HOURS = 6 * 60 * 60 * 1000;
          const since = new Date(Date.now() - SIX_HOURS);

          const latest = await prisma.instagramPostMetric.findFirst({
            where: { postId: post.id, pulledAt: { gte: since } },
            orderBy: { pulledAt: "desc" },
            select: { id: true },
          });

          if (latest?.id) {
            await prisma.instagramPostMetric.update({
              where: { id: latest.id },
              data: {
                pulledAt: new Date(),
                reach,
                likes,
                comments,
                shares,
                saves,
                plays,
                videoViews,
                totalInteractions,
                raw: withInsights ? (withInsights as any) : undefined,
              },
            });
          } else {
            await prisma.instagramPostMetric.create({
              data: {
                postId: post.id,
                pulledAt: new Date(),
                reach,
                likes,
                comments,
                shares,
                saves,
                plays,
                videoViews,
                totalInteractions,
                raw: withInsights ? (withInsights as any) : undefined,
              },
            });
          }
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? "POST_INSIGHTS_ERROR");
          await prisma.instagramBackfillJob.update({
            where: { id: jobId },
            data: { lastError: msg },
          });
        } finally {
          processed++;

          const now = Date.now();
          const shouldUpdateByCount = processed % PROGRESS_EVERY === 0;
          const shouldUpdateByTime = now - lastProgressUpdateAt > 3000;

          if (shouldUpdateByCount || shouldUpdateByTime) {
            lastProgressUpdateAt = now;
            await prisma.instagramBackfillJob.update({
              where: { id: jobId },
              data: {
                importedCount: imported,
                processedCount: processed,
              },
            });
          }

          if (perPostDelayMs > 0) await sleep(perPostDelayMs);
        }
      }

      after = nextCursor;

      await prisma.instagramBackfillJob.update({
        where: { id: jobId },
        data: {
          cursor: after ?? null,
          importedCount: imported,
          processedCount: processed,
        },
      });

      if (!after) break;
      if (perPageDelayMs > 0) await sleep(perPageDelayMs);
    }

    await prisma.instagramBackfillJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        finishedAt: new Date(),
        cursor: after ?? null,
        importedCount: imported,
        processedCount: processed,
      },
    });

    return { imported, processed, status: "done" as const };
  }
}
