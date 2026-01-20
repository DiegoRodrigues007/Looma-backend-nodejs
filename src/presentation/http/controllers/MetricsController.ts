import { Request, Response } from "express";
import { MetricsService } from "../../../application/services/metrics/MetricsService";
import { PrismaMetricsSnapshotRepository } from "../../../infrastructure/db/repositories/PrismaMetricsSnapshotRepository";
import { MetricsPlatform, MetricsSnapshot } from "../../../domain/entities/MetricsSnapshot";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { InstagramMetricsService } from "../../../infrastructure/instagram/services/InstagramMetricsService";

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

  // =====================================================
  // SNAPSHOT (1x POR DIA - NÃO SOBRESCREVE)
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

      const repo = new PrismaMetricsSnapshotRepository();

      // ✅ Se já existe snapshot desse dia, NÃO sobrescreve
      const already = await repo.findByDate(userId, platform, day);
      if (already) {
        return res.json({
          saved: false,
          date: day.toISOString().slice(0, 10),
          reason: "Snapshot already exists for today",
        });
      }

      // ✅ Busca métricas e salva
      const metrics = await InstagramMetricsService.fetchDailyMetrics(igUserId, accessToken);

      await repo.save(
        new MetricsSnapshot(
          userId,
          platform,
          day,
          metrics.followers,
          metrics.reach,
          metrics.totalInteractions,
          metrics.engagementRate // ✅ já é percentual (ex: 5.79)
        )
      );

      return res.json({
        saved: true,
        date: day.toISOString().slice(0, 10),
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
  // - garante follower correto pegando a conta mais recente
  // - compara sempre com o snapshot do "dia anterior"
  //   (mesmo que já exista snapshot de hoje)
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

      const live = await InstagramMetricsService.fetchDailyMetrics(igUserId, accessToken);

      const repo = new PrismaMetricsSnapshotRepository();

      // ✅ sempre compara com o dia anterior (UTC)
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
          engagementRate: live.engagementRate, // ✅ já é %
        },
        {
          followers: previousSnapshot.followers,
          reach: previousSnapshot.reach,
          totalInteractions: previousSnapshot.totalInteractions,
          engagementRate: previousSnapshot.engagementRate, // ✅ já é %
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
  // - compara com snapshot de "today - days"
  // - se não existir exatamente, usa o mais recente <= aquele dia
  // =====================================================
  async instagramPeriod(req: Request, res: Response) {
    try {
      const userId = req.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const platform: MetricsPlatform = "instagram";

      const daysRaw = Number(req.query.days ?? 7);
      const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.floor(daysRaw) : 7;

      const { igUserId, accessToken } = await this.getConnectedInstagramAccount(userId);

      if (!igUserId || !accessToken) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      const live = await InstagramMetricsService.fetchDailyMetrics(igUserId, accessToken);

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
          engagementRate: live.engagementRate, // ✅ já é %
        },
        {
          followers: previousSnapshot.followers,
          reach: previousSnapshot.reach,
          totalInteractions: previousSnapshot.totalInteractions,
          engagementRate: previousSnapshot.engagementRate, // ✅ já é %
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
