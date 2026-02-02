export type UserAuthData = {
  id: string;
  activeInstagramAccountId?: string | null;
};

export interface IUserRepository {
  getById(userId: string): Promise<UserAuthData | null>;
  getActiveInstagramAccountId(userId: string): Promise<string | null>;
  setActiveInstagramAccountId(
    userId: string,
    instagramAccountId: string
  ): Promise<void>;
}
