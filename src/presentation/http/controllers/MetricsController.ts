// src/presentation/http/controllers/MetricsController.ts
import { Request, Response } from "express";
import { MetricsService } from "../../../application/services/metrics/MetricsService";
import { PrismaMetricsSnapshotRepository } from "../../../infrastructure/db/repositories/PrismaMetricsSnapshotRepository";
import { MetricsPlatform } from "../../../domain/entities/MetricsSnapshot";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { InstagramMetricsService } from "../../../infrastructure/instagram/services/InstagramMetricsService";
import type { AxiosError } from "axios";

export class MetricsController {
  // =====================================================
  // Helpers de data (UTC para bater com o repositório)
  // =====================================================
  private startOfDayUTC(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private addDaysUTC(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  /**
   * Busca a conta IG correta (a mais recente conectada) + token certo
   */
  private async getConnectedInstagramAccount(userId: string) {
    const account = await prisma.instagramAccount.findFirst({
      where: { userId, isConnected: true },
      orderBy: { updatedAt: "desc" }, // ✅ pega sempre a mais recente
      select: {
        igUserId: true, // ✅ FIX: era instagramId
        accessToken: true,
        pageAccessToken: true,
      },
    });

    const igUserId = account?.igUserId ?? null;
    const accessToken = (account?.pageAccessToken ?? account?.accessToken) ?? null;

    return { igUserId, accessToken };
  }

  /**
   * Pega snapshot em um dia específico; se não existir, pega o mais recente <= esse dia.
   * (usando findPrevious com "beforeDate = day + 1")
   */
  private async findSnapshotOnOrBefore(
    repo: PrismaMetricsSnapshotRepository,
    userId: string,
    platform: MetricsPlatform,
    dayUTC: Date
  ) {
    const exact = await repo.findByDate(userId, platform, dayUTC);
    if (exact) return exact;

    // ✅ "on or before": busca o último snapshot antes de (day + 1)
    return repo.findPrevious(userId, platform, this.addDaysUTC(dayUTC, 1));
  }

  /**
   * Trata erros comuns do Graph API para respostas mais estáveis:
   * - 429: rate limit -> 503
   * - 400/401/403: token inválido/expirado/revogado -> 400
   *
   * Retorna true se já respondeu o HTTP e o caller deve "return".
   */
  private handleInstagramGraphError(res: Response, error: unknown): boolean {
    const anyErr = error as any;

    // AxiosError costuma expor response.status
    const status: number | undefined =
      (anyErr?.response?.status as number | undefined) ??
      ((anyErr as AxiosError | undefined)?.response?.status as number | undefined);

    if (status === 429) {
      res.status(503).json({
        message: "Instagram Graph API rate limited",
      });
      return true;
    }

    if (status === 400 || status === 401 || status === 403) {
      res.status(400).json({
        message: "Instagram token invalid, expired, or revoked",
      });
      return true;
    }

    return false;
  }

  // =====================================================
  // SNAPSHOT (1x POR DIA - IDPOTENTE + SEGURO EM CONCORRÊNCIA)
  // =====================================================
  async instagramEnsureSnapshot(req: Request, res: Response) {
    try {
      const userId = req.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const platform: MetricsPlatform = "instagram";

      const { igUserId, accessToken } = await this.getConnectedInstagramAccount(userId);

      if (!igUserId || !accessToken) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      // ✅ Snapshot do DIA ATUAL (UTC) — 1x por dia
      const day = this.startOfDayUTC(new Date());
      const dayYmd = day.toISOString().slice(0, 10);

      const repo = new PrismaMetricsSnapshotRepository();

      // ✅ Busca métricas (live) antes de salvar
      let metrics: {
        followers: number;
        reach: number;
        totalInteractions: number;
        engagementRate: number;
      };

      try {
        metrics = await InstagramMetricsService.fetchDailyMetrics(igUserId, accessToken);
      } catch (err) {
        if (this.handleInstagramGraphError(res, err)) return;
        throw err;
      }

      /**
       * ✅ IDPOTÊNCIA + CONCORRÊNCIA:
       * - Não pode ser UPSERT, porque upsert sempre "salva" (cria ou atualiza)
       * - Precisa ser CREATE-only + capturar unique violation
       * - Assim: 1 request -> created=true (saved=true)
       *          concorrente/segunda -> created=false (saved=false)
       */
      const created = await repo.createDailyIfNotExists(userId, platform, metrics, day);

      if (!created) {
        return res.json({
          saved: false,
          date: dayYmd,
          reason: "Snapshot already exists for today",
        });
      }

      return res.json({
        saved: true,
        date: dayYmd,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Failed to ensure Instagram snapshot",
      });
    }
  }

  // =====================================================
  // OVERVIEW (LIVE vs DIA ANTERIOR)
  // =====================================================
  async instagramOverview(req: Request, res: Response) {
    try {
      const userId = req.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const platform: MetricsPlatform = "instagram";

      const { igUserId, accessToken } = await this.getConnectedInstagramAccount(userId);

      if (!igUserId || !accessToken) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      let live: {
        followers: number;
        reach: number;
        totalInteractions: number;
        engagementRate: number;
      };

      try {
        live = await InstagramMetricsService.fetchDailyMetrics(igUserId, accessToken);
      } catch (err) {
        if (this.handleInstagramGraphError(res, err)) return;
        throw err;
      }

      const repo = new PrismaMetricsSnapshotRepository();

      const today = this.startOfDayUTC(new Date());
      const yesterday = this.addDaysUTC(today, -1);

      const previousSnapshot = await this.findSnapshotOnOrBefore(repo, userId, platform, yesterday);

      if (!previousSnapshot) {
        return res.status(204).send();
      }

      const overview = MetricsService.buildOverview(
        {
          followers: live.followers,
          reach: live.reach,
          totalInteractions: live.totalInteractions,
          engagementRate: live.engagementRate,
        },
        {
          followers: previousSnapshot.followers,
          reach: previousSnapshot.reach,
          totalInteractions: previousSnapshot.totalInteractions,
          engagementRate: previousSnapshot.engagementRate,
        }
      );

      return res.json({
        ...overview,
        hasComparison: true,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Failed to load Instagram overview",
      });
    }
  }

  // =====================================================
  // PERIOD (?days=7) (LIVE vs snapshot de N dias atrás)
  // =====================================================
  async instagramPeriod(req: Request, res: Response) {
    try {
      const userId = req.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const platform: MetricsPlatform = "instagram";

      // ✅ Validação STRICT de input:
      // - se não vier, default 7
      // - se vier, tem que ser inteiro positivo (sem decimal/strings)
      let days = 7;

      if (req.query.days !== undefined) {
        const raw = String(req.query.days).trim();

        // permite apenas dígitos (sem sinal, sem ponto)
        if (!/^\d+$/.test(raw)) {
          return res.status(400).json({ message: "Invalid 'days' query param" });
        }

        const n = Number(raw);

        if (!Number.isFinite(n) || n <= 0) {
          return res.status(400).json({ message: "Invalid 'days' query param" });
        }

        days = n;
      }

      const { igUserId, accessToken } = await this.getConnectedInstagramAccount(userId);

      if (!igUserId || !accessToken) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      let live: {
        followers: number;
        reach: number;
        totalInteractions: number;
        engagementRate: number;
      };

      try {
        live = await InstagramMetricsService.fetchDailyMetrics(igUserId, accessToken);
      } catch (err) {
        if (this.handleInstagramGraphError(res, err)) return;
        throw err;
      }

      const repo = new PrismaMetricsSnapshotRepository();

      const today = this.startOfDayUTC(new Date());
      const targetDay = this.addDaysUTC(today, -days);

      const previousSnapshot = await this.findSnapshotOnOrBefore(repo, userId, platform, targetDay);

      if (!previousSnapshot) {
        return res.status(204).send();
      }

      const overview = MetricsService.buildOverview(
        {
          followers: live.followers,
          reach: live.reach,
          totalInteractions: live.totalInteractions,
          engagementRate: live.engagementRate,
        },
        {
          followers: previousSnapshot.followers,
          reach: previousSnapshot.reach,
          totalInteractions: previousSnapshot.totalInteractions,
          engagementRate: previousSnapshot.engagementRate,
        }
      );

      return res.json({
        ...overview,
        hasComparison: true,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Failed to load Instagram period",
      });
    }
  }
}