import axios, { AxiosInstance } from "axios";

export interface ShortTokenResponse {
  shortToken: string;
  userId?: string | null;
}

export interface LongTokenResponse {
  longToken: string;
  expiresAt?: Date | null;
}

export interface MeResponse {
  igUserId: string;
  username: string;
  accountType: string;
}

export class InstagramIgLoginClient {
  private http: AxiosInstance;

  private authUrl = process.env.INSTAGRAM_AUTH_URL ?? "https://api.instagram.com/oauth/authorize";
  private tokenUrl = process.env.INSTAGRAM_TOKEN_URL ?? "https://graph.instagram.com/access_token";
  private refreshUrl = process.env.INSTAGRAM_REFRESH_URL ?? "https://graph.instagram.com/refresh_access_token";

  private clientId = process.env.INSTAGRAM_CLIENT_ID!;
  private clientSecret = process.env.INSTAGRAM_CLIENT_SECRET!;
  private redirectUri = process.env.INSTAGRAM_REDIRECT_URI!;
  private scopes = (process.env.INSTAGRAM_SCOPES ?? "instagram_basic,instagram_manage_insights")
    .split(",")
    .map(s => s.trim())
    .join(",");

  constructor() {
    this.http = axios.create({
      baseURL: "https://graph.instagram.com",
      timeout: 10000
    });
  }

  buildLoginUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: this.scopes,
      response_type: "code",
      state
    });

    return `${this.authUrl}?${params.toString()}`;
  }

  async exchangeCodeForShortToken(code: string): Promise<ShortTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: "authorization_code",
      code
    });

    const url = `${this.tokenUrl}?${params.toString()}`;
    const res = await axios.get(url);
    const data = res.data as { access_token: string; user_id?: string };

    return {
      shortToken: data.access_token,
      userId: data.user_id
    };
  }

  async exchangeShortForLong(shortToken: string): Promise<LongTokenResponse> {
    const params = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: this.clientSecret,
      access_token: shortToken
    });

    const url = `${this.tokenUrl}?${params.toString()}`;
    const res = await axios.get(url);
    const data = res.data as { access_token: string; expires_in?: number };

    const expiresAt =
      data.expires_in != null ? new Date(Date.now() + data.expires_in * 1000) : undefined;

    return {
      longToken: data.access_token,
      expiresAt
    };
  }

  async refreshLong(longToken: string): Promise<string> {
    const params = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: longToken
    });

    const url = `${this.refreshUrl}?${params.toString()}`;
    const res = await axios.get(url);
    const data = res.data as { access_token: string };

    return data.access_token;
  }

  async getMe(accessToken: string): Promise<MeResponse> {
    const url = `/me?fields=id,username,account_type&access_token=${encodeURIComponent(accessToken)}`;
    const res = await this.http.get(url);
    const data = res.data as { id: string; username: string; account_type: string };

    return {
      igUserId: data.id,
      username: data.username,
      accountType: data.account_type
    };
  }
}
