// src/presentation/http/controllers/InsightsController.ts

import { Request, Response } from "express";

import {
  WeeklyInsightsService,
  TopContentForInsights,
} from "../../../application/services/WeeklyInsightsService";

import { prisma } from "../../../infrastructure/db/prismaClient";
import { InstagramTopContentService } from "../../../infrastructure/instagram/InstagramTopContentService";

// ✅ Tooltip orchestrator
import { PostInsightsOrchestratorService } from "../../../application/services/PostInsightsOrchestratorService";

/* =========================
   Helpers
========================= */
function getUserIdFromReq(req: Request): string | null {
  const anyReq = req as any;

  return (
    anyReq.userId ||
    anyReq.user?.id ||
    anyReq.user?.userId ||
    anyReq.user?.sub || // ✅ IMPORTANTÍSSIMO (seu middleware usa sub)
    anyReq.auth?.userId ||
    anyReq.session?.userId ||
    null
  );
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseYmd(ymdStr: string): Date {
  return new Date(`${ymdStr}T00:00:00.000Z`);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function clampInt(n: number, min: number, max: number, fallback: number) {
  const num = Number(n);
  if (!Number.isFinite(num)) return fallback;
  const v = Math.floor(num);
  return Math.min(Math.max(v, min), max);
}

type IgCreds = {
  igUserId: string;
  accessToken: string;
};

/**
 * Tenta extrair campos padrão do orchestrator de forma robusta,
 * sem “quebrar” caso o formato mude.
 */
function pickInsightPayload(data: any) {
  const verdict =
    data?.verdict ?? data?.result?.verdict ?? data?.rules?.verdict ?? null;
  const score = data?.score ?? data?.result?.score ?? data?.rules?.score ?? null;
  const evidence =
    data?.evidence ?? data?.result?.evidence ?? data?.rules?.evidence ?? null;

  const why = data?.why ?? data?.narrated?.why ?? data?.narration?.why ?? null;
  const improve =
    data?.improve ??
    data?.narrated?.improve ??
    data?.narration?.improve ??
    null;
  const continueDoing =
    data?.continue ??
    data?.continueDoing ??
    data?.narrated?.continue ??
    data?.narration?.continue ??
    null;

  return { verdict, score, evidence, why, improve, continueDoing };
}

/** Normaliza score para Float? do Prisma */
function normalizeScore(score: any): number | null {
  if (score === null || score === undefined) return null;
  if (typeof score === "number") return Number.isFinite(score) ? score : null;
  const n = Number(score);
  return Number.isFinite(n) ? n : null;
}

/**
 * Prisma: evidence/why/improve/continue são Json obrigatórios.
 * Então aqui garantimos que nunca será null/undefined.
 */
function ensureJson(value: any, fallback: any) {
  if (value === null || value === undefined) return fallback;
  return value;
}

export class InsightsController {
  private readonly topContentService = new InstagramTopContentService();

  // ✅ tooltip
  private readonly postInsightsService = new PostInsightsOrchestratorService();

  constructor(private readonly weeklyInsightsService: WeeklyInsightsService) {}

  /**
   * ✅ Busca credenciais do IG corretamente pela tabela instagramAccount
   * - suporta multi-conta via query param instagramAccountId
   * - usa pageAccessToken se existir (normalmente é o que dá mais certo)
   */
  private async getConnectedInstagramCreds(
    userId: string,
    instagramAccountId?: string | null
  ): Promise<IgCreds | null> {
    const account = await prisma.instagramAccount.findFirst({
      where: {
        userId,
        isConnected: true,
        ...(instagramAccountId ? { id: instagramAccountId } : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        igUserId: true, // ✅ CORRETO (no seu schema é igUserId)
        accessToken: true,
        pageAccessToken: true,
      },
    });

    const igUserId = account?.igUserId ? String(account.igUserId) : null;
    const token = (account?.pageAccessToken ?? account?.accessToken) ?? null;

    if (!igUserId || !token) return null;

    return { igUserId, accessToken: String(token) };
  }

  /**
   * GET /api/metrics/instagram/insights/weekly?days=7&instagramAccountId=...
   */
  async weeklyInstagramInsights(req: Request, res: Response) {
    try {
      const userId = getUserIdFromReq(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const instagramAccountId = String(
        (req.query.instagramAccountId ?? "") as any
      ).trim();
      const accountFilter = instagramAccountId ? instagramAccountId : null;

      const daysRaw = Number(req.query.days ?? 7);
      const days = clampInt(daysRaw, 3, 30, 7);

      // ✅ Período atual (pra buscar TopContent)
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const to = today;
      const fromAll = addDays(to, -(days * 2 - 1));
      const currentFrom = addDays(parseYmd(ymd(fromAll)), days);

      const periodFrom = ymd(currentFrom);
      const periodTo = ymd(to);

      // ✅ tenta buscar topContent para regras adicionais
      let topContent: TopContentForInsights[] | undefined;

      try {
        const creds = await this.getConnectedInstagramCreds(
          String(userId),
          accountFilter
        );

        if (creds) {
          const top = await this.topContentService.fetchTopContent({
            accessToken: creds.accessToken,
            igUserId: creds.igUserId,
            from: periodFrom,
            to: periodTo,
            limit: 10,
          });

          topContent = top.map((x) => ({
            totalInteractions: Number(x.totalInteractions ?? 0),
            reach:
              x.reach !== undefined && x.reach !== null
                ? Number(x.reach)
                : undefined,
            captionLength: x.captionLength,
            mediaType: x.mediaType,
          }));
        } else {
          topContent = undefined;
        }
      } catch {
        topContent = undefined;
      }

      const data = await this.weeklyInsightsService.generateForUser(
        String(userId),
        "instagram",
        days,
        topContent
      );

      return res.status(200).json(data);
    } catch (err: any) {
      return res.status(500).json({
        message: "Failed to generate weekly insights",
        error: err?.message ?? String(err),
      });
    }
  }

  /**
   * ✅ Tooltip do gráfico
   * GET /api/metrics/instagram/insights/post?postId=...&baselineDays=30&instagramAccountId=...
   *
   * ✅ DB-FIRST + UPSERT por unique composto:
   * postId_baselineWindowDays
   */
  async instagramPostInsights(req: Request, res: Response) {
    try {
      const userId = getUserIdFromReq(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const postIdRaw = String(req.query.postId ?? "").trim();
      if (!postIdRaw)
        return res.status(400).json({ message: "postId is required" });

      const instagramAccountId = String(
        (req.query.instagramAccountId ?? "") as any
      ).trim();
      const accountFilter = instagramAccountId ? instagramAccountId : null;

      const baselineDaysRaw = Number(req.query.baselineDays ?? 30);
      const baselineDays = clampInt(baselineDaysRaw, 7, 90, 30);

      const creds = await this.getConnectedInstagramCreds(
        String(userId),
        accountFilter
      );

      if (!creds) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      /**
       * 1) Resolver o "post interno" (InstagramPosts.id) a partir do postId do front.
       *    - Se o front mandar igMediaId (ex: "1795070..."), buscamos por igMediaId
       *    - Se mandar UUID (id interno), tentamos buscar por id
       *
       * ✅ importante: filtra por instagramAccountId quando vier
       * (assim evita misturar duas contas do mesmo user)
       */
      const postWhereBase: any = {
        userId: String(userId),
        ...(accountFilter ? { instagramAccountId: accountFilter } : {}),
      };

      const post =
        (await prisma.instagramPost.findFirst({
          where: { ...postWhereBase, igMediaId: postIdRaw },
          select: { id: true, igMediaId: true },
        })) ??
        (await prisma.instagramPost.findFirst({
          where: { ...postWhereBase, id: postIdRaw },
          select: { id: true, igMediaId: true },
        }));

      if (!post?.id) {
        // Se não tem o post no banco ainda, ainda dá pra calcular via API,
        // mas não dá pra salvar resultado sem postId interno.
        const data = await this.postInsightsService.run({
          accessToken: creds.accessToken,
          igUserId: creds.igUserId,
          postId: postIdRaw, // aqui é igMediaId
          baselineDays,
        });

        return res.status(200).json({
          ...data,
          meta: {
            ...(data?.meta ?? {}),
            insightsSource: "computed_not_persisted",
            reason: "post_not_found_in_db",
          },
        });
      }

      /**
       * 2) DB-FIRST: tenta pegar resultado já salvo
       */
      const cached = await prisma.instagramPostInsightResult.findFirst({
        where: {
          postId: post.id,
          baselineWindowDays: baselineDays,
        },
        orderBy: { computedAt: "desc" },
      });

      if (cached) {
        return res.status(200).json({
          ok: true,
          source: "database",
          postId: post.igMediaId ?? postIdRaw,
          baselineDays,
          verdict: (cached as any).verdict ?? null,
          score: (cached as any).score ?? null,
          evidence: (cached as any).evidence ?? null,
          why: (cached as any).why ?? null,
          improve: (cached as any).improve ?? null,
          continue: (cached as any).continue ?? null,
        });
      }

      /**
       * 3) Se não tiver no banco, calcula
       */
      const data = await this.postInsightsService.run({
        accessToken: creds.accessToken,
        igUserId: creds.igUserId,
        postId: post.igMediaId ?? postIdRaw,
        baselineDays,
      });

      const picked = pickInsightPayload(data);

      /**
       * 4) Normaliza payload para não quebrar o Prisma (campos obrigatórios)
       */
      const safeVerdict = String(picked.verdict ?? "stable");
      const safeScore = normalizeScore(picked.score);

      // JSON obrigatórios: nunca podem ser null
      const safeEvidence = ensureJson(picked.evidence, []);
      const safeWhy = ensureJson(picked.why, []);
      const safeImprove = ensureJson(picked.improve, []);
      const safeContinue = ensureJson(picked.continueDoing, []);

      /**
       * 5) Persistência (UPSERT) com unique composto
       */
      try {
        await prisma.instagramPostInsightResult.upsert({
          where: {
            postId_baselineWindowDays: {
              postId: post.id,
              baselineWindowDays: baselineDays,
            },
          },
          update: {
            verdict: safeVerdict,
            score: safeScore,
            evidence: safeEvidence,
            why: safeWhy,
            improve: safeImprove,
            continue: safeContinue,
            computedAt: new Date(),
          },
          create: {
            postId: post.id,
            baselineWindowDays: baselineDays,
            verdict: safeVerdict,
            score: safeScore,
            evidence: safeEvidence,
            why: safeWhy,
            improve: safeImprove,
            continue: safeContinue,
            // computedAt tem default
          },
        });
      } catch (e: any) {
        // ✅ Agora você vê o motivo (sem quebrar a UX do tooltip)
        return res.status(200).json({
          ...data,
          meta: {
            ...(data?.meta ?? {}),
            insightsSource: "computed_but_persist_failed",
            persistError: e?.message ?? String(e),
          },
        });
      }

      /**
       * 6) Retorna pro front
       */
      return res.status(200).json({
        ...data,
        meta: {
          ...(data?.meta ?? {}),
          insightsSource: "computed_and_persisted",
        },
      });
    } catch (err: any) {
      const status = Number(err?.statusCode) || 500;

      return res.status(status).json({
        message: err?.message ?? "Failed to generate post insights",
        code: err?.code,
        details: err?.details,
      });
    }
  }
}
