export type YouTubeTokenPayload = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
};

export type YouTubeChannelInfo = {
  channelId: string;
  title?: string | null;
  handle?: string | null;
  subscribers?: number | null;
  views?: number | null;
  videos?: number | null;
};

export type YouTubeTopContentItem = {
  videoId: string;

  title?: string | null;
  thumb?: string | null;
  publishedAt?: string | null;

  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number; 

  likes?: number;
  comments?: number;

  permalink: string;

  engagementRate: number;
};

export interface IYouTubeAuthService {
  buildLoginUrl(state: string): string;

  exchangeCodeForTokens(code: string): Promise<YouTubeTokenPayload>;

  refreshAccessToken(
    refreshToken: string
  ): Promise<Pick<YouTubeTokenPayload, "accessToken" | "expiresAt">>;

  getMyChannel(accessToken: string): Promise<YouTubeChannelInfo>;

  getAnalyticsDaily(opts: {
    accessToken: string;
    from: string;
    to: string; 
  }): Promise<{
    rows: Array<{
      day: string;
      views: number;
      estimatedMinutesWatched: number;
      averageViewDuration: number;
      subscribersGained: number;
      subscribersLost: number;
    }>;
  }>;

  getTopContent(opts: {
    accessToken: string;
    from: string; 
    to: string; 
    limit: number;
  }): Promise<{
    items: YouTubeTopContentItem[];
  }>;
}
