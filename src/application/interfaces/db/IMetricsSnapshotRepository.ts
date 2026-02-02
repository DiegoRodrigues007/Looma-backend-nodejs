import type { MetricsSnapshot } from "../../../domain/entities/MetricsSnapshot";

type Platform = "instagram";

export interface IMetricsSnapshotRepository {
  save(snapshot: MetricsSnapshot): Promise<void>;

  findByDate(args: {
    userId: string;
    platform: Platform;
    date: Date;
  }): Promise<MetricsSnapshot | null>;

  findRange(args: {
    userId: string;
    platform: Platform;
    start: Date;
    end: Date;
  }): Promise<MetricsSnapshot[]>;

  findLatest(args: {
    userId: string;
    platform: Platform;
  }): Promise<MetricsSnapshot | null>;

  findPrevious(args: {
    userId: string;
    platform: Platform;
    date: Date;
  }): Promise<MetricsSnapshot | null>;

  getFollowersByUserPlatformDate(args: {
    userId: string;
    platform: Platform;
    date: Date;
  }): Promise<number | null>;

  upsertFollowersSnapshot(args: {
    userId: string;
    platform: Platform;
    date: Date;
    followers: number;
  }): Promise<void>;
}
