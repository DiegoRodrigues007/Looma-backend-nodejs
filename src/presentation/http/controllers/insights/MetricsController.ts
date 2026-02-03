import { Request, Response } from "express";
import { MetricsService } from "../../../../application/services/metrics/MetricsService";
import { PrismaMetricsSnapshotRepository } from "../../../../infrastructure/db/repositories/metrics/PrismaMetricsSnapshotRepository";
import { MetricsPlatform } from "../../../../domain/entities/MetricsSnapshot";
import { prisma } from "../../../../infrastructure/db/prismaClient";
import { InstagramMetricsService } from "../../../../application/services/instagram/InstagramMetricsService";
import { AxiosInstagramMetricsClient } from "../../../../infrastructure/instagram/clients/AxiosInstagramMetricsClient";
import type { AxiosError } from "axios";

export class MetricsController {

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

  private async getConnectedInstagramAccount(userId: string) {
    const account = await prisma.instagramAccount.findFirst({
      where: { userId, isConnected: true },
      orderBy: { updatedAt: "desc" }, 
      select: {
        igUserId: true, 
        accessToken: true,
        pageAccessToken: true,
      },
    });

    const igUserId = account?.igUserId ?? null;
    const accessToken =
      (account?.pageAccessToken ?? account?.accessToken) ?? null;

    return { igUserId, accessToken };
  }

  private async findSnapshotOnOrBefore(
    repo: PrismaMetricsSnapshotRepository,
    userId: string,
    platform: MetricsPlatform,
    dayUTC: Date
  ) {
    const exact = await (repo as any).findByDate(userId, platform, dayUTC);
    if (exact) return exact;

    return (repo as any).findPrevious(userId, platform, this.addDaysUTC(dayUTC, 1));

  }

  private handleInstagramGraphError(res: Response, error: unknown): boolean {
    const anyErr = error as any;

    const status: number | undefined =
      (anyErr?.response?.status as number | undefined) ??
      ((anyErr as AxiosError | undefined)?.response?.status as
        | number
        | undefined);

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

  private makeInstagramMetricsService() {
    const metricsClient = new AxiosInstagramMetricsClient();
    return new InstagramMetricsService(metricsClient);
  }

  async instagramEnsureSnapshot(req: Request, res: Response) {
    try {
      const userId = req.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const platform: MetricsPlatform = "instagram";

      const { igUserId, accessToken } = await this.getConnectedInstagramAccount(
        userId
      );

      if (!igUserId || !accessToken) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      const day = this.startOfDayUTC(new Date());
      const dayYmd = day.toISOString().slice(0, 10);

      const repo = new PrismaMetricsSnapshotRepository();
      const igMetricsService = this.makeInstagramMetricsService();

      let metrics: {
        followers: number;
        reach: number;
        totalInteractions: number;
        engagementRate: number;
      };

      try {
        metrics = await igMetricsService.fetchDailyMetrics(igUserId, accessToken);
      } catch (err) {
        if (this.handleInstagramGraphError(res, err)) return;
        throw err;
      }

      const created = await (repo as any).createDailyIfNotExists(
        userId,
        platform,
        metrics,
        day
      );

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

  async instagramOverview(req: Request, res: Response) {
    try {
      const userId = req.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const platform: MetricsPlatform = "instagram";

      const { igUserId, accessToken } = await this.getConnectedInstagramAccount(
        userId
      );

      if (!igUserId || !accessToken) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      const igMetricsService = this.makeInstagramMetricsService();

      let live: {
        followers: number;
        reach: number;
        totalInteractions: number;
        engagementRate: number;
      };

      try {
        live = await igMetricsService.fetchDailyMetrics(igUserId, accessToken);
      } catch (err) {
        if (this.handleInstagramGraphError(res, err)) return;
        throw err;
      }

      const repo = new PrismaMetricsSnapshotRepository();

      const today = this.startOfDayUTC(new Date());
      const yesterday = this.addDaysUTC(today, -1);

      const previousSnapshot = await this.findSnapshotOnOrBefore(
        repo,
        userId,
        platform,
        yesterday
      );

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

  async instagramPeriod(req: Request, res: Response) {
    try {
      const userId = req.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const platform: MetricsPlatform = "instagram";

      let days = 7;

      if (req.query.days !== undefined) {
        const raw = String(req.query.days).trim();

        if (!/^\d+$/.test(raw)) {
          return res.status(400).json({ message: "Invalid 'days' query param" });
        }

        const n = Number(raw);

        if (!Number.isFinite(n) || n <= 0) {
          return res.status(400).json({ message: "Invalid 'days' query param" });
        }

        days = n;
      }

      const { igUserId, accessToken } = await this.getConnectedInstagramAccount(
        userId
      );

      if (!igUserId || !accessToken) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      const igMetricsService = this.makeInstagramMetricsService();

      let live: {
        followers: number;
        reach: number;
        totalInteractions: number;
        engagementRate: number;
      };

      try {
        live = await igMetricsService.fetchDailyMetrics(igUserId, accessToken);
      } catch (err) {
        if (this.handleInstagramGraphError(res, err)) return;
        throw err;
      }

      const repo = new PrismaMetricsSnapshotRepository();

      const today = this.startOfDayUTC(new Date());
      const targetDay = this.addDaysUTC(today, -days);

      const previousSnapshot = await this.findSnapshotOnOrBefore(
        repo,
        userId,
        platform,
        targetDay
      );

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
