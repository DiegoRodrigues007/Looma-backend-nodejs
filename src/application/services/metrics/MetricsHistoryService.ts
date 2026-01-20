import { IMetricsSnapshotRepository } from "../../../domain/repositories/IMetricsSnapshotRepository";
import { MetricsSnapshot, MetricsPlatform } from "../../../domain/entities/MetricsSnapshot";
import { aggregateSnapshotsAverage } from "../../../domain/metrics/calculators/aggregateSnapshots";

type SnapshotInput = Omit<MetricsSnapshot, "userId" | "platform" | "date">;

export class MetricsHistoryService {
  constructor(private readonly repo: IMetricsSnapshotRepository) {}

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private normalizeRange(from: Date, to: Date): { from: Date; to: Date } {
    const f = this.startOfDay(from);
    const t = this.endOfDay(to);
    return { from: f, to: t };
  }

  async saveDailySnapshot(
    userId: string,
    platform: MetricsPlatform,
    snapshot: SnapshotInput,
    date?: Date
  ): Promise<void> {
    const day = this.startOfDay(date ?? new Date());

    const entity = new MetricsSnapshot(
      userId,
      platform,
      day,
      snapshot.followers,
      snapshot.reach,
      snapshot.totalInteractions,
      snapshot.engagementRate
    );

    await this.repo.save(entity);
  }

  async ensureDailySnapshot(
    userId: string,
    platform: MetricsPlatform,
    snapshot: SnapshotInput,
    date?: Date
  ): Promise<boolean> {
    const day = this.startOfDay(date ?? new Date());

    const existing = await this.repo.findByDate(userId, platform, day);
    if (existing) return false;

    const entity = new MetricsSnapshot(
      userId,
      platform,
      day,
      snapshot.followers,
      snapshot.reach,
      snapshot.totalInteractions,
      snapshot.engagementRate
    );

    await this.repo.save(entity);
    return true;
  }

  async getPeriodAverage(
    userId: string,
    platform: MetricsPlatform,
    from: Date,
    to: Date
  ): Promise<MetricsSnapshot | null> {
    const range = this.normalizeRange(from, to);

    const data = await this.repo.findRange(userId, platform, range.from, range.to);

    return aggregateSnapshotsAverage({
      userId,
      platform,
      date: range.to,
      data,
    });
  }
}
