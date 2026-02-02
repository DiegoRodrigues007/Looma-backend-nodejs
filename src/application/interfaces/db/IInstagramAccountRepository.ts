export type InstagramAccountRecord = {
  id: string;
  userId: string;
  isConnected: boolean;

  igUserId?: string | null;

  accessToken?: string | null;
  pageAccessToken?: string | null;

  tokenExpiresAt?: Date | null;

  grantedScopes?: string | null;
};

export type UpdateInstagramAccountTokenInput = {
  instagramAccountId: string;
  userId: string;

  accessToken: string;
  tokenExpiresAt: Date | null;

  pageAccessToken?: string | null;
  lastRefreshedAt?: Date | null;
};

export type InstagramAccountListDTO = {
  id: string;
  igUserId: string;
  username: string | null;
  accountType: string | null;
  facebookPageId: string | null;
  expiresAt: Date | null;
  isConnected: boolean;
  updatedAt: Date;
};

export interface IInstagramAccountRepository {

  findById(userId: string, accountId: string): Promise<InstagramAccountRecord | null>;

  findConnectedById(
    userId: string,
    accountId: string
  ): Promise<InstagramAccountRecord | null>;

  findLatestConnected(userId: string): Promise<InstagramAccountRecord | null>;

  updateToken(input: UpdateInstagramAccountTokenInput): Promise<void>;

  listByUser(userId: string): Promise<InstagramAccountListDTO[]>;
}
