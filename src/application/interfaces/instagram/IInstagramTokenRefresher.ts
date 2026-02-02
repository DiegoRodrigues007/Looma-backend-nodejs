export type RefreshLongLivedTokenInput = {
  longLivedToken: string;
};

export type RefreshLongLivedTokenOutput = {
  accessToken: string;
  expiresInSeconds: number; 
};

export interface IInstagramTokenRefresher {
  refreshLongLivedToken(
    input: RefreshLongLivedTokenInput
  ): Promise<RefreshLongLivedTokenOutput>;
}
