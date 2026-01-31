import { prisma } from "../../prismaClient";
import type { IMetricsSnapshotRepository } from "../../../../domain/repositories/IMetricsSnapshotRepository";
import {
  MetricsSnapshot,
  MetricsPlatform,
} from "../../../../domain/entities/MetricsSnapshot";

export class PrismaMetricsSnapshotRepository implements IMetricsSnapshotRepository {
  private toDomain(row: any): MetricsSnapshot {
    return row as MetricsSnapshot;
  }

  private toPrismaCreate(snapshot: MetricsSnapshot) {
    const s: any = snapshot as any;

    return {
      userId: String(s.userId),
      platform: s.platform as MetricsPlatform,
      date: s.date as Date,

      followers: Number(s.followers ?? 0),
      reach: Number(s.reach ?? 0),
      totalInteractions: Number(s.totalInteractions ?? 0),
      engagementRate: Number(s.engagementRate ?? 0),
    };
  }

  async save(snapshot: MetricsSnapshot): Promise<void> {
    const data = this.toPrismaCreate(snapshot);

    await prisma.metricsSnapshot.create({
      data,
    });
  }

  async findByDate(
    userId: string,
    platform: MetricsPlatform,
    date: Date,
  ): Promise<MetricsSnapshot | null> {
    const row = await prisma.metricsSnapshot.findUnique({
      where: {
        userId_platform_date: {
          userId,
          platform,
          date,
        },
      },
    });

    return row ? this.toDomain(row) : null;
  }

  async findRange(
    userId: string,
    platform: MetricsPlatform,
    from: Date,
    to: Date,
  ): Promise<MetricsSnapshot[]> {
    const rows = await prisma.metricsSnapshot.findMany({
      where: {
        userId,
        platform,
        date: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { date: "asc" },
    });

    return rows.map((r) => this.toDomain(r));
  }

  async findLatest(
    userId: string,
    platform: MetricsPlatform,
  ): Promise<MetricsSnapshot | null> {
    const row = await prisma.metricsSnapshot.findFirst({
      where: { userId, platform },
      orderBy: { date: "desc" },
    });

    return row ? this.toDomain(row) : null;
  }

  async findPrevious(
    userId: string,
    platform: MetricsPlatform,
    beforeDate: Date,
  ): Promise<MetricsSnapshot | null> {
    const row = await prisma.metricsSnapshot.findFirst({
      where: {
        userId,
        platform,
        date: { lt: beforeDate },
      },
      orderBy: { date: "desc" },
    });

    return row ? this.toDomain(row) : null;
  }

  async getFollowersByUserPlatformDate(args: {
    userId: string;
    platform: MetricsPlatform;
    date: Date;
  }): Promise<number | null> {
    const row = await prisma.metricsSnapshot.findUnique({
      where: {
        userId_platform_date: {
          userId: args.userId,
          platform: args.platform,
          date: args.date,
        },
      },
      select: { followers: true },
    });

    return row?.followers ?? null;
  }

  async upsertFollowersSnapshot(args: {
    userId: string;
    platform: MetricsPlatform;
    date: Date;
    followers: number;
  }): Promise<void> {
    await prisma.metricsSnapshot.upsert({
      where: {
        userId_platform_date: {
          userId: args.userId,
          platform: args.platform,
          date: args.date,
        },
      },
      create: {
        userId: args.userId,
        platform: args.platform,
        date: args.date,
        followers: args.followers,

        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      },
      update: {
        followers: args.followers,
      },
    });
  }
}
