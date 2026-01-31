export type UserAuthData = {
  id: string;
  activeInstagramAccountId?: string | null;
};

export interface IUserAuthRepository {
  getAuthDataById(userId: string): Promise<UserAuthData | null>;
}
