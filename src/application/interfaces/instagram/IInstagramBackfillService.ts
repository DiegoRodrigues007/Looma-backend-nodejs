export type BackfillDailyMetricsResult = {
  fetchedDays: number;
  errors: Array<{ day: string; message: string }>;
};

export interface IInstagramBackfillService {
  backfillDailyMetrics(args: {
    requestId?: string;
    userId: string;
    instagramAccountId: string;
    igUserId: string;
    pageAccessToken: string;
    days: string[]; 
    concurrency: number;
  }): Promise<BackfillDailyMetricsResult>;

  getFollowersCountNow(args: {
    igUserId: string;
    pageAccessToken: string;
  }): Promise<number>;
}
