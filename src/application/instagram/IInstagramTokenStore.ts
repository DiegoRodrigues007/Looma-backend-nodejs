export interface InstagramTokenRecord {
  igUserId: string;
  accessToken: string;
  expiresAt?: Date | null;
  username?: string | null;
  accountType?: string | null;
  facebookPageId?: string | null;
  pageAccessToken?: string | null;
  lastRefreshedAt?: Date | null;
}

export type InstagramTokenUpsert = {
  igUserId: string;
  username: string;
  accountType: string;
  accessToken: string;
  expiresAt?: Date | null;
  facebookPageId?: string | null;
  pageAccessToken?: string | null;
  lastRefreshedAt?: Date | null;
};

export interface IInstagramTokenStore {
  get(igUserId: string): Promise<InstagramTokenRecord | null>;
  saveOrUpdate(data: InstagramTokenUpsert): Promise<void>;
}
