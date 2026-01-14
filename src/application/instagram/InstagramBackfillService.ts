// src/application/instagram/InstagramBackfillService.ts
import axios from "axios";
import { prisma } from "../../infrastructure/db/prismaClient";
import { InstagramPostInsightsService } from "../../infrastructure/instagram/InstagramPostInsightsService";

/**
 * Backfill do Instagram:
 * - pagina /{igUserId}/media (posts antigos)
 * - upsert em InstagramPost
 * - busca insights por post (reach/saves/shares...) via InstagramPostInsightsService
 * - grava InstagramPostMetric (pulledAt = now)
 * - atualiza InstagramBackfillJob (cursor e progresso)
 *
 * ✅ Pensado pra rodar em worker (não em request).
 * ✅ Seguro (não quebra tudo por 1 post com erro).
 * ✅ Idempotente (na prática): não duplica métricas muito próximas para o mesmo post.
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
  instagramAccountId?: string | null;
  igUserId: string;
  accessToken: string;
  jobId: string;

  maxPosts?: number;
  maxPages?: number;

  // controle de rate-limit (ajuste fino depois)
  perPostDelayMs?: number;
  perPageDelayMs?: number;

  // se você quiser continuar de um cursor salvo:
  startAfterCursor?: string | null;

  /**
   * ✅ Hook opcional:
   * chamado assim que um post foi upsertado no banco.
   * (use isso pra preencher instagramPostInsightResults em outro serviço)
   */
  onPostImported?: (payload: {
    userId: string;
    instagramAccountId: string | null;
    igUserId: string;
    postDbId: string;
    igMediaId: string;
  }) => Promise<void>;
};

export class InstagramBackfillService {
  // ✅ permite configurar a versão/base pelo .env (mantém compatível)
  private readonly graphBaseUrl =
    process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";

  private readonly postInsights = new InstagramPostInsightsService();

  /**
   * Rodar backfill para uma conta IG.
   */
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

    const maxPosts = clamp(params.maxPosts ?? 300, 50, 2000);
    const maxPages = clamp(params.maxPages ?? 20, 5, 80);

    const perPostDelayMs = clamp(params.perPostDelayMs ?? 120, 0, 5000);
    const perPageDelayMs = clamp(params.perPageDelayMs ?? 150, 0, 10000);

    // campos do /media
    const fields =
      "id,caption,media_type,permalink,timestamp,like_count,comments_count";

    // cursor
    let after: string | undefined = startAfterCursor ?? undefined;

    let page = 0;
    let imported = 0;
    let processed = 0;

    // ✅ reduz “spam” de update no job
    const PROGRESS_EVERY = 10; // atualiza contadores a cada 10 posts
    let lastProgressUpdateAt = Date.now();

    // ✅ marca job como running (se já estiver running, só garante startedAt)
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

      // --- chama Graph API /media ---
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
          }
        );
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? "GRAPH_REQUEST_ERROR");
        await prisma.instagramBackfillJob.update({
          where: { id: jobId },
          data: { status: "error", lastError: msg, finishedAt: new Date() },
        });
        return { imported, processed, status: "error" as const, error: msg };
      }

      // se falhar, marca erro e para
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

      // cursor da próxima página (salva no final desta página)
      const nextAfter = resp.data?.paging?.cursors?.after;
      const nextCursor = nextAfter || undefined;

      // processa cada post da página
      for (const m of rows) {
        if (imported >= maxPosts) break;

        const igMediaId = safeStr(m.id).trim();
        if (!igMediaId) continue;

        const publishedAt = new Date(String(m.timestamp));
        if (Number.isNaN(publishedAt.getTime())) {
          // timestamp inválido? pula sem quebrar
          processed++;
          continue;
        }

        // 1) upsert do post (idempotente por igMediaId)
        const post = await prisma.instagramPost.upsert({
          where: { igMediaId },
          create: {
            userId,
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
            mediaType: m.media_type ?? null,
            publishedAt,
            caption: m.caption ?? null,
            permalink: m.permalink ?? null,
            likeCount: toInt(m.like_count, 0),
            commentsCount: toInt(m.comments_count, 0),
          },
        });

        imported++;

        // ✅ hook opcional (pra preencher instagramPostInsightResults depois)
        if (onPostImported) {
          try {
            await onPostImported({
              userId,
              instagramAccountId: instagramAccountId ?? null,
              igUserId,
              postDbId: post.id,
              igMediaId,
            });
          } catch (e: any) {
            // não quebra backfill
            const msg = String(e?.message ?? e ?? "ON_POST_IMPORTED_ERROR");
            await prisma.instagramBackfillJob.update({
              where: { id: jobId },
              data: { lastError: msg },
            });
          }
        }

        // 2) busca insights do post (reach/saves/shares etc.)
        // ⚠️ não derruba o backfill por causa de um post com erro
        try {
          const withInsights = await this.postInsights.fetchPostById({
            accessToken,
            postId: igMediaId,
          });

          const reach = toInt((withInsights as any)?.reach, 0);
          const saves = toInt((withInsights as any)?.saves, 0);
          const shares = toInt((withInsights as any)?.shares, 0);

          // likes/comments vêm do /media (mais barato)
          const likes = toInt(m.like_count, 0);
          const comments = toInt(m.comments_count, 0);

          const plays = toInt((withInsights as any)?.plays, 0);
          const videoViews = toInt((withInsights as any)?.videoViews, 0);

          const totalInteractions = likes + comments + shares + saves;

          /**
           * ✅ Idempotência prática:
           * - se já existe uma métrica MUITO recente pro mesmo post, atualiza em vez de criar outra.
           * - isso evita “encher” a tabela se o job rodar repetido.
           *
           * Ajuste aqui se quiser:
           * - 6h = bem seguro
           */
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

          // ✅ atualiza progresso de forma mais leve
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

          // rate limit simples
          if (perPostDelayMs > 0) await sleep(perPostDelayMs);
        }
      }

      // ✅ salva cursor depois de processar a página (checkpoint real)
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

    // finaliza
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
