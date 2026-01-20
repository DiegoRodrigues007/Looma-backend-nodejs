export type InstagramMe = {
  igUserId: string;
  username: string;
  accountType: string;
  facebookPageId?: string | null;
  pageAccessToken?: string | null;
};

export type IgCandidate = {
  igUserId: string;
  username: string;
  accountType: string;

  facebookPageId: string;
  facebookPageName?: string;

  pageAccessToken: string;

  source: "instagram_business_account" | "connected_instagram_account";
};

export type InstagramAuthResolved = {
  status: "ok";
  candidates: IgCandidate[];
};

export type InstagramAuthReauthRequired = {
  status: "reauth_required";
  loginUrl: string;
  missingPermissions: string[];
};


export interface IInstagramIgLoginAuthService {

  /**
   * Gera URL de login do Facebook/Instagram
   * @param state string de segurança (csrf / userId / etc)
   * @param forceReRequest força novo consentimento
   */
  buildLoginUrl(state: string, forceReRequest?: boolean): string;

  exchangeCodeForShortToken(
    code: string
  ): Promise<{
    shortToken: string;
    userId?: string | null;
  }>;

  exchangeShortForLong(
    shortToken: string
  ): Promise<{
    longToken: string;
    expiresAt?: Date | null;
  }>;

  refreshLongToken(longToken: string): Promise<string>;

  resolveMeOrReauth(
    accessToken: string
  ): Promise<InstagramAuthResolved | InstagramAuthReauthRequired>;

  getMe(accessToken: string): Promise<InstagramMe>;
}
