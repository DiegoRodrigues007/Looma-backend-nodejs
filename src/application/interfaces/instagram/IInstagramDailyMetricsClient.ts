export type DailyInsights = {
  reach: number;
  profileViews: number;
  accountsEngaged: number;
};

export type FetchFollowersInput = {
  igUserId: string;
  accessToken: string;
  timeoutMs?: number;
};

export type FetchInsightsDayInput = {
  igUserId: string;
  accessToken: string;
  dayYmd: string; 
  timeoutMs?: number;
};

export interface IInstagramDailyMetricsClient {
  getFollowersCount(input: FetchFollowersInput): Promise<number>;
  getInsightsForDay(input: FetchInsightsDayInput): Promise<DailyInsights>;
}
