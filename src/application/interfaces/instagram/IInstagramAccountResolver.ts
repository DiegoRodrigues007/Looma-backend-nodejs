export type ConnectedInstagramAccount = {
  id: string;
  igUserId: string;
  pageAccessToken: string;
};

export interface IInstagramAccountResolver {
  getActiveOrLatestConnectedAccount(userId: string): Promise<ConnectedInstagramAccount | null>;
}
