export interface IMetricsSnapshotRepository {
  getFollowersByUserPlatformDate(args: {
    userId: string;
    platform: "instagram";
    date: Date;
  }): Promise<number | null>;

  upsertFollowersSnapshot(args: {
    userId: string;
    platform: "instagram";
    date: Date;
    followers: number;
  }): Promise<void>;
}
