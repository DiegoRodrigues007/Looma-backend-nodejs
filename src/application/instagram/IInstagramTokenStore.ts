export interface InstagramTokenRecord {
  userId: string;
  igUserId: string;
  accessToken: string;
  pageAccessToken?: string | null;
  facebookPageId?: string | null;
  username?: string | null;
  accountType?: string | null;
  expiresAt?: Date | null;
  lastRefreshedAt?: Date | null;
  isConnected: boolean;
  grantedScopes?: string | null;
}

export interface SaveOrUpdateInstagramTokenInput {
  userId: string;
  igUserId: string;
  accessToken: string;
  pageAccessToken?: string | null;
  facebookPageId?: string | null;
  username?: string | null;
  accountType?: string | null;
  expiresAt?: Date | null;
  lastRefreshedAt?: Date | null;
  isConnected: boolean;
  grantedScopes?: string | null;
}

export interface IInstagramTokenStore {
  getByUserId(userId: string): Promise<InstagramTokenRecord | null>;
  saveOrUpdate(input: SaveOrUpdateInstagramTokenInput): Promise<void>;
}
