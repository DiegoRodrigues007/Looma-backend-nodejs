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
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return Math.min(Math.max(v, min), max);
}

type IgCreds = {
  igUserId: string;
  accessToken: string;
};

export class InsightsController {
  private readonly topContentService = new InstagramTopContentService();

  // ✅ tooltip
  private readonly postInsightsService = new PostInsightsOrchestratorService();

  constructor(private readonly weeklyInsightsService: WeeklyInsightsService) {}

  /**
   * ✅ Busca credenciais do IG corretamente pela tabela instagramAccount
   * - usa pageAccessToken se existir (normalmente é o que dá mais certo)
   */
  private async getConnectedInstagramCreds(userId: string): Promise<IgCreds | null> {
    const account = await prisma.instagramAccount.findFirst({
      where: { userId, isConnected: true },
      orderBy: { updatedAt: "desc" },
      select: {
        instagramId: true,
        accessToken: true,
        pageAccessToken: true,
      },
    });

    const igUserId = account?.instagramId ? String(account.instagramId) : null;
    const token = (account?.pageAccessToken ?? account?.accessToken) ?? null;

    if (!igUserId || !token) return null;

    return { igUserId, accessToken: String(token) };
  }

  /**
   * GET /api/metrics/instagram/insights/weekly?days=7
   */
  async weeklyInstagramInsights(req: Request, res: Response) {
    try {
      const userId = getUserIdFromReq(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

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
        const creds = await this.getConnectedInstagramCreds(String(userId));

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
            reach: x.reach !== undefined && x.reach !== null ? Number(x.reach) : undefined,
            captionLength: x.captionLength,
            mediaType: x.mediaType,
          }));
        } else {
          // Sem IG conectado -> segue sem topContent (não quebra weekly)
          topContent = undefined;
        }
      } catch (e) {
        // não quebra weekly por falha no TopContent
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
   * GET /api/metrics/instagram/insights/post?postId=...&baselineDays=30
   */
  async instagramPostInsights(req: Request, res: Response) {
    try {
      const userId = getUserIdFromReq(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const postId = String(req.query.postId ?? "").trim();
      if (!postId) {
        return res.status(400).json({ message: "postId is required" });
      }

      const baselineDaysRaw = Number(req.query.baselineDays ?? 30);
      const baselineDays = clampInt(baselineDaysRaw, 7, 90, 30);

      const creds = await this.getConnectedInstagramCreds(String(userId));
      if (!creds) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      const data = await this.postInsightsService.run({
        accessToken: creds.accessToken,
        igUserId: creds.igUserId,
        postId,
        baselineDays,
      });

      // ✅ não impõe formato aqui: apenas devolve o que o orchestrator retornar
      // (inclusive narrated / narratedJson etc)
      return res.status(200).json(data);
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
