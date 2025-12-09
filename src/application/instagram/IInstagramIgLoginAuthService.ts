export interface IInstagramIgLoginAuthService {
  buildLoginUrl(state: string): string;
  exchangeCodeForShortToken(code: string): Promise<{ shortToken: string; userId?: string | null }>;
  exchangeShortForLong(shortToken: string): Promise<{ longToken: string; expiresAt?: Date | null }>;
  refreshLongToken(longToken: string): Promise<string>;
  getMe(accessToken: string): Promise<{ igUserId: string; username: string; accountType: string }>;
}
