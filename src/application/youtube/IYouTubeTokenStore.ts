export type YouTubeTokenRecord = {
  userId: string;
  channelId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  grantedScopes: string | null;
  lastRefreshedAt: Date | null;
};

export type SaveOrUpdateYouTubeTokenInput = {
  userId: string;
  channelId: string;
  channelTitle?: string | null;
  channelHandle?: string | null;

  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  grantedScopes?: string | null;
  lastRefreshedAt?: Date | null;

  isConnected?: boolean;
};

export interface IYouTubeTokenStore {
  getByUserId(userId: string): Promise<YouTubeTokenRecord | null>;
  disconnect(userId: string): Promise<void>;
  saveOrUpdate(input: SaveOrUpdateYouTubeTokenInput): Promise<void>;
}
