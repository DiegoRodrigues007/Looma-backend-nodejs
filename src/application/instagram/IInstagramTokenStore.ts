export interface InstagramTokenRecord {
  accessToken: string;
  expiresAt?: Date | null;
}

export interface IInstagramTokenStore {
  get(igUserId: string): Promise<InstagramTokenRecord | null>;
  saveOrUpdate(igUserId: string, accessToken: string, expiresAt?: Date | null): Promise<void>;
}
