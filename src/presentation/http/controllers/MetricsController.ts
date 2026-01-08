import { Request, Response } from "express";
import { MetricsService } from "../../../application/services/MetricsService";
import { PrismaMetricsSnapshotRepository } from "../../../infrastructure/db/PrismaMetricsSnapshotRepository";
import { MetricsPlatform, MetricsSnapshot } from "../../../domain/entities/MetricsSnapshot";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { InstagramMetricsService } from "../../../infrastructure/instagram/InstagramMetricsService";

export class MetricsController {
  // =====================================================
  // Helpers de data
  // =====================================================
  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  // Dia fechado = ontem
  private closedDayBase(): Date {
    const today0 = this.startOfDay(new Date());
    return this.addDays(today0, -1);
  }

  // =====================================================
  // SNAPSHOT (1x POR DIA - NÃO SOBRESCREVE)
  // =====================================================
  async instagramEnsureSnapshot(req: Request, res: Response) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const platform: MetricsPlatform = "instagram";

      const account = await prisma.instagramAccount.findFirst({
        where: { userId, isConnected: true },
        select: {
          instagramId: true,
          accessToken: true,
        },
      });

      if (!account?.instagramId || !account?.accessToken) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      // ✅ Snapshot do DIA ATUAL (1x por dia)
      const day = this.startOfDay(new Date());

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

      // ✅ Só busca métricas e salva se ainda não tiver snapshot do dia
      const metrics = await InstagramMetricsService.fetchDailyMetrics(
        account.instagramId,
        account.accessToken
      );

      await repo.save(
        new MetricsSnapshot(
          userId,
          platform,
          day,
          metrics.followers,
          metrics.reach,
          metrics.totalInteractions,
          metrics.engagementRate
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
  // OVERVIEW (AGORA vs ÚLTIMO SNAPSHOT)
  // =====================================================
  async instagramOverview(req: Request, res: Response) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const platform: MetricsPlatform = "instagram";

      const account = await prisma.instagramAccount.findFirst({
        where: { userId, isConnected: true },
        select: {
          instagramId: true,
          accessToken: true,
        },
      });

      if (!account?.instagramId || !account?.accessToken) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      // 🔴 DADOS AO VIVO
      const live = await InstagramMetricsService.fetchDailyMetrics(
        account.instagramId,
        account.accessToken
      );

      const repo = new PrismaMetricsSnapshotRepository();
      const latestSnapshot = await repo.findLatest(userId, platform);

      if (!latestSnapshot) {
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
          followers: latestSnapshot.followers,
          reach: latestSnapshot.reach,
          totalInteractions: latestSnapshot.totalInteractions,
          engagementRate: latestSnapshot.engagementRate,
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
  // PERIOD (compatível com o front)
  // =====================================================
  async instagramPeriod(req: Request, res: Response) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const platform: MetricsPlatform = "instagram";

      const account = await prisma.instagramAccount.findFirst({
        where: { userId, isConnected: true },
        select: {
          instagramId: true,
          accessToken: true,
        },
      });

      if (!account?.instagramId || !account?.accessToken) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      const live = await InstagramMetricsService.fetchDailyMetrics(
        account.instagramId,
        account.accessToken
      );

      const repo = new PrismaMetricsSnapshotRepository();
      const latestSnapshot = await repo.findLatest(userId, platform);

      if (!latestSnapshot) {
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
          followers: latestSnapshot.followers,
          reach: latestSnapshot.reach,
          totalInteractions: latestSnapshot.totalInteractions,
          engagementRate: latestSnapshot.engagementRate,
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
