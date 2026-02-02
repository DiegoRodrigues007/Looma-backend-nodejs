import { prisma } from "../../prismaClient";
import {
  MetricsSnapshot,
  MetricsPlatform,
} from "../../../../domain/entities/MetricsSnapshot";
import { IMetricsSnapshotRepository } from "../../../../domain/repositories/IMetricsSnapshotRepository";

type Platform = "instagram";

// ✅ args exatamente como a interface
type FindByDateArgs = {
  userId: string;
  platform: Platform;
  date: Date;
};

type FindRangeArgs = {
  userId: string;
  platform: Platform;
  start: Date;
  end: Date;
};

type FindLatestArgs = {
  userId: string;
  platform: Platform;
};

type FindPreviousArgs = {
  userId: string;
  platform: Platform;
  date: Date; // ✅ interface usa "date"
};

export class PrismaMetricsSnapshotRepository
  implements IMetricsSnapshotRepository
{
  private normalizeDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private normalizeFrom(date: Date): Date {
    return this.normalizeDay(date);
  }

  private normalizeTo(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(23, 59, 59, 999);
    return d;
  }

  async save(snapshot: MetricsSnapshot): Promise<void> {
    const day = this.normalizeDay(snapshot.date);

    await prisma.metricsSnapshot.upsert({
      where: {
        userId_platform_date: {
          userId: snapshot.userId,
          platform: snapshot.platform,
          date: day,
        },
      },
      update: {
        followers: snapshot.followers,
        reach: snapshot.reach,
        totalInteractions: snapshot.totalInteractions,
        engagementRate: snapshot.engagementRate,
      },
      create: {
        userId: snapshot.userId,
        platform: snapshot.platform,
        date: day,
        followers: snapshot.followers,
        reach: snapshot.reach,
        totalInteractions: snapshot.totalInteractions,
        engagementRate: snapshot.engagementRate,
      },
    });
  }

  /* =========================
     ✅ Interface: findByDate({ userId, platform, date })
     + Compat antigo opcional: findByDate(userId, platform, date)
  ========================= */

  findByDate(args: FindByDateArgs): Promise<MetricsSnapshot | null>;
  findByDate(
    userId: string,
    platform: MetricsPlatform,
    date: Date
  ): Promise<MetricsSnapshot | null>;
  async findByDate(
    a: any,
    b?: MetricsPlatform,
    c?: Date
  ): Promise<MetricsSnapshot | null> {
    const userId: string = typeof a === "object" ? a.userId : a;
    const platform: MetricsPlatform =
      typeof a === "object" ? (a.platform as MetricsPlatform) : (b as MetricsPlatform);
    const date: Date = typeof a === "object" ? a.date : (c as Date);

    const day = this.normalizeDay(date);

    const row = await prisma.metricsSnapshot.findUnique({
      where: {
        userId_platform_date: {
          userId,
          platform,
          date: day,
        },
      },
    });

    if (!row) return null;

    return new MetricsSnapshot(
      row.userId,
      row.platform as MetricsPlatform,
      row.date,
      row.followers,
      row.reach,
      row.totalInteractions,
      row.engagementRate
    );
  }

  /* =========================
     ✅ Interface: findRange({ start, end })
     + Compat antigo opcional: findRange(userId, platform, from, to)
  ========================= */

  findRange(args: FindRangeArgs): Promise<MetricsSnapshot[]>;
  findRange(
    userId: string,
    platform: MetricsPlatform,
    from: Date,
    to: Date
  ): Promise<MetricsSnapshot[]>;
  async findRange(
    a: any,
    b?: MetricsPlatform,
    c?: Date,
    d?: Date
  ): Promise<MetricsSnapshot[]> {
    const userId: string = typeof a === "object" ? a.userId : a;
    const platform: MetricsPlatform =
      typeof a === "object" ? (a.platform as MetricsPlatform) : (b as MetricsPlatform);

    // ✅ interface usa start/end
    const start: Date = typeof a === "object" ? a.start : (c as Date);
    const end: Date = typeof a === "object" ? a.end : (d as Date);

    const fromDay = this.normalizeFrom(start);
    const toDay = this.normalizeTo(end);

    const rows = await prisma.metricsSnapshot.findMany({
      where: {
        userId,
        platform,
        date: {
          gte: fromDay,
          lte: toDay,
        },
      },
      orderBy: { date: "asc" },
    });

    return rows.map(
      (row) =>
        new MetricsSnapshot(
          row.userId,
          row.platform as MetricsPlatform,
          row.date,
          row.followers,
          row.reach,
          row.totalInteractions,
          row.engagementRate
        )
    );
  }

  /* =========================
     ✅ Interface: findLatest({ userId, platform })
     + Compat antigo opcional: findLatest(userId, platform)
  ========================= */

  findLatest(args: FindLatestArgs): Promise<MetricsSnapshot | null>;
  findLatest(
    userId: string,
    platform: MetricsPlatform
  ): Promise<MetricsSnapshot | null>;
  async findLatest(
    a: any,
    b?: MetricsPlatform
  ): Promise<MetricsSnapshot | null> {
    const userId: string = typeof a === "object" ? a.userId : a;
    const platform: MetricsPlatform =
      typeof a === "object" ? (a.platform as MetricsPlatform) : (b as MetricsPlatform);

    const row = await prisma.metricsSnapshot.findFirst({
      where: { userId, platform },
      orderBy: { date: "desc" },
    });

    if (!row) return null;

    return new MetricsSnapshot(
      row.userId,
      row.platform as MetricsPlatform,
      row.date,
      row.followers,
      row.reach,
      row.totalInteractions,
      row.engagementRate
    );
  }

  /* =========================
     ✅ Interface: findPrevious({ userId, platform, date })
     + Compat antigo opcional: findPrevious(userId, platform, date)
  ========================= */

  findPrevious(args: FindPreviousArgs): Promise<MetricsSnapshot | null>;
  findPrevious(
    userId: string,
    platform: MetricsPlatform,
    date: Date
  ): Promise<MetricsSnapshot | null>;
  async findPrevious(
    a: any,
    b?: MetricsPlatform,
    c?: Date
  ): Promise<MetricsSnapshot | null> {
    const userId: string = typeof a === "object" ? a.userId : a;
    const platform: MetricsPlatform =
      typeof a === "object" ? (a.platform as MetricsPlatform) : (b as MetricsPlatform);

    // ✅ interface usa "date" (não beforeDate)
    const date: Date = typeof a === "object" ? a.date : (c as Date);

    const beforeDay = this.normalizeDay(date);

    const row = await prisma.metricsSnapshot.findFirst({
      where: {
        userId,
        platform,
        date: { lt: beforeDay },
      },
      orderBy: { date: "desc" },
    });

    if (!row) return null;

    return new MetricsSnapshot(
      row.userId,
      row.platform as MetricsPlatform,
      row.date,
      row.followers,
      row.reach,
      row.totalInteractions,
      row.engagementRate
    );
  }

  async getFollowersByUserPlatformDate(args: {
    userId: string;
    platform: MetricsPlatform;
    date: Date;
  }): Promise<number | null> {
    const day = this.normalizeDay(args.date);

    const row = await prisma.metricsSnapshot.findUnique({
      where: {
        userId_platform_date: {
          userId: args.userId,
          platform: args.platform,
          date: day,
        },
      },
      select: { followers: true },
    });

    return row ? row.followers : null;
  }

  async upsertFollowersSnapshot(args: {
    userId: string;
    platform: MetricsPlatform;
    date: Date;
    followers: number;
  }): Promise<void> {
    const day = this.normalizeDay(args.date);

    await prisma.metricsSnapshot.upsert({
      where: {
        userId_platform_date: {
          userId: args.userId,
          platform: args.platform,
          date: day,
        },
      },
      update: {
        followers: args.followers,
      },
      create: {
        userId: args.userId,
        platform: args.platform,
        date: day,
        followers: args.followers,
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      },
    });
  }
}
