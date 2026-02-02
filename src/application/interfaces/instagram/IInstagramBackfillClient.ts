export type DailyInsights = {
  reach: number;
  profileViews: number;
  totalInteractions: number;
};

export interface IInstagramBackfillClient {
  getDailyInsights(input: {
    igUserId: string;
    pageAccessToken: string;
    dayYmd: string; 
    timeoutMs?: number;
  }): Promise<DailyInsights>;

  getFollowersCountNow(input: {
    igUserId: string;
    pageAccessToken: string;
    timeoutMs?: number;
  }): Promise<number>;
}
