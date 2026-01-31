export type InstagramDailyMetricRow = {
  day: Date;
  followers: number | null;
  reach: number | null;
  profileViewsTotal: number | null;
  totalInteractions: number | null;
};

export interface IInstagramDailyMetricsRepository {
  listByRange(args: {
    userId: string;
    instagramAccountId: string;
    from: Date;
    to: Date;
  }): Promise<InstagramDailyMetricRow[]>;
}
