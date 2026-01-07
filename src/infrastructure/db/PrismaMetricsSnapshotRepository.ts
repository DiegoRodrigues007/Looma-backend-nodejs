import { prisma } from "./prismaClient";
import {
  MetricsSnapshot,
  MetricsPlatform,
} from "../../domain/entities/MetricsSnapshot";
import { IMetricsSnapshotRepository } from "../../domain/repositories/IMetricsSnapshotRepository";

export class PrismaMetricsSnapshotRepository
  implements IMetricsSnapshotRepository
{
  // =====================================================
  // Helpers de data (REGRA ÚNICA)
  // =====================================================

  /**
   * Normaliza qualquer data para o "dia lógico" (00:00 UTC).
   * Evita bugs de fuso horário e inversão de dia.
   */
  private normalizeDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private normalizeFrom(date: Date): Date {
    return this.normalizeDay(date);
  }

  private normalizeTo(date: Date): Date {
    return this.normalizeDay(date);
  }

  // =====================================================
  // Save (UPSERT base)
  // =====================================================
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

  // =====================================================
  // ✅ NOVO MÉTODO (USADO PELO CONTROLLER)
  // =====================================================
  async upsertDaily(
    userId: string,
    platform: MetricsPlatform,
    metrics: {
      followers: number;
      reach: number;
      totalInteractions: number;
      engagementRate: number;
    },
    date: Date
  ): Promise<void> {
    const snapshot = new MetricsSnapshot(
      userId,
      platform,
      date,
      metrics.followers,
      metrics.reach,
      metrics.totalInteractions,
      metrics.engagementRate
    );

    await this.save(snapshot);
  }

  // =====================================================
  // Reads
  // =====================================================
  async findByDate(
    userId: string,
    platform: MetricsPlatform,
    date: Date
  ): Promise<MetricsSnapshot | null> {
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

  async findRange(
    userId: string,
    platform: MetricsPlatform,
    from: Date,
    to: Date
  ): Promise<MetricsSnapshot[]> {
    const fromDay = this.normalizeFrom(from);
    const toDay = this.normalizeTo(to);

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

  async findLatest(
    userId: string,
    platform: MetricsPlatform
  ): Promise<MetricsSnapshot | null> {
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

  async findPrevious(
    userId: string,
    platform: MetricsPlatform,
    beforeDate: Date
  ): Promise<MetricsSnapshot | null> {
    const beforeDay = this.normalizeDay(beforeDate);

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
}
