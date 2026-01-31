import { IMetricsSnapshotRepository } from "../../../domain/repositories/IMetricsSnapshotRepository";
import { MetricsSnapshot, MetricsPlatform } from "../../../domain/entities/MetricsSnapshot";
import { aggregateSnapshotsAverage } from "../../../domain/metrics/calculators/aggregateSnapshots";

type SnapshotInput = Omit<MetricsSnapshot, "userId" | "platform" | "date">;

function startOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e: any = err;

  if (e.code === "P2002") return true;

  const msg = String(e.message || "").toLowerCase();
  if (msg.includes("unique constraint")) return true;
  if (msg.includes("duplicate key")) return true;

  return false;
}

export class MetricsHistoryService {
  constructor(private readonly repo: IMetricsSnapshotRepository) {}

  private normalizeRange(from: Date, to: Date): { from: Date; to: Date } {
    return { from: startOfDayUTC(from), to: endOfDayUTC(to) };
  }

  async saveDailySnapshot(
    userId: string,
    platform: MetricsPlatform,
    snapshot: SnapshotInput,
    date?: Date
  ): Promise<void> {
    const day = startOfDayUTC(date ?? new Date());

    const entity = new MetricsSnapshot(
      userId,
      platform,
      day,
      Number(snapshot.followers) || 0,
      Number(snapshot.reach) || 0,
      Number(snapshot.totalInteractions) || 0,
      Number(snapshot.engagementRate) || 0
    );

    await this.repo.save(entity);
  }

  async ensureDailySnapshot(
    userId: string,
    platform: MetricsPlatform,
    snapshot: SnapshotInput,
    date?: Date
  ): Promise<boolean> {
    const day = startOfDayUTC(date ?? new Date());

    const existing = await this.repo.findByDate(userId, platform, day);
    if (existing) return false;

    const entity = new MetricsSnapshot(
      userId,
      platform,
      day,
      Number(snapshot.followers) || 0,
      Number(snapshot.reach) || 0,
      Number(snapshot.totalInteractions) || 0,
      Number(snapshot.engagementRate) || 0
    );

    try {
      await this.repo.save(entity);
      return true;
    } catch (err) {
      if (isUniqueConstraintError(err)) return false;
      throw err;
    }
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
