export type InstagramMetricsResult = {
  followers: number;
  reach: number;
  totalInteractions: number;
  engagementRate: number;
};

export type FetchDailyMetricsInput = {
  instagramAccountId: string;
  accessToken: string;
  timeoutMs?: number;
};

export interface IInstagramMetricsClient {
  getFollowersCount(input: FetchDailyMetricsInput): Promise<number>;
  getDailyReach(input: FetchDailyMetricsInput): Promise<number>;
  getDailyTotalInteractions(input: FetchDailyMetricsInput): Promise<number>;
}
