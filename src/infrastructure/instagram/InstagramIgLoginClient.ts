import axios, { AxiosInstance, AxiosError } from "axios";

export interface ShortTokenResponse {
  shortToken: string;
  userId?: string | null; // no Facebook OAuth, geralmente não vem user_id aqui
}

export interface LongTokenResponse {
  longToken: string;
  expiresAt?: Date | null;
}

export interface MeResponse {
  igUserId: string;
  username: string;

  /**
   * No IG Graph API (IGUser) NÃO existe "account_type".
   * Mantemos esse campo por compatibilidade com o resto do projeto.
   */
  accountType: string;

  // úteis para você salvar e usar depois
  facebookPageId?: string;
  pageAccessToken?: string;
}

type PageItem = { id: string; name?: string; access_token?: string };

export class InstagramIgLoginClient {
  private http: AxiosInstance;

  // Facebook/Graph (Business/Creator)
  private graphBaseUrl =
    process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";
  private authUrl =
    process.env.INSTAGRAM_AUTH_URL ?? "https://www.facebook.com/v21.0/dialog/oauth";
  private tokenUrl =
    process.env.INSTAGRAM_TOKEN_URL ?? "https://graph.facebook.com/v21.0/oauth/access_token";

  private clientId = process.env.INSTAGRAM_CLIENT_ID!;
  private clientSecret = process.env.INSTAGRAM_CLIENT_SECRET!;
  private redirectUri = process.env.INSTAGRAM_REDIRECT_URI!;

  // scopes corretos pra IG Business/Creator via Graph
  private scopes = (
    process.env.INSTAGRAM_SCOPES ??
    "public_profile,email,pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights"
  )
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .join(",");

  constructor() {
    this.http = axios.create({
      baseURL: this.graphBaseUrl,
      timeout: 15000
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

  /**
   * code -> user access token (short-lived)
   */
  async exchangeCodeForShortToken(code: string): Promise<ShortTokenResponse> {
    try {
      const res = await axios.get(this.tokenUrl, {
        params: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
          code
        }
      });

      const data = res.data as { access_token: string };
      return { shortToken: data.access_token, userId: null };
    } catch (e) {
      throw this.wrapAxios(e, "exchangeCodeForShortToken");
    }
  }

  /**
   * short-lived -> long-lived (fb_exchange_token)
   */
  async exchangeShortForLong(shortToken: string): Promise<LongTokenResponse> {
    try {
      const res = await axios.get(this.tokenUrl, {
        params: {
          grant_type: "fb_exchange_token",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          fb_exchange_token: shortToken
        }
      });

      const data = res.data as { access_token: string; expires_in?: number };
      const expiresAt =
        data.expires_in != null ? new Date(Date.now() + data.expires_in * 1000) : undefined;

      return { longToken: data.access_token, expiresAt };
    } catch (e) {
      throw this.wrapAxios(e, "exchangeShortForLong");
    }
  }

  /**
   * "refresh" de long-lived: re-exchange (prático)
   */
  async refreshLong(longToken: string): Promise<string> {
    try {
      const res = await axios.get(this.tokenUrl, {
        params: {
          grant_type: "fb_exchange_token",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          fb_exchange_token: longToken
        }
      });

      const data = res.data as { access_token: string };
      return data.access_token;
    } catch (e) {
      throw this.wrapAxios(e, "refreshLong");
    }
  }

  /**
   * Pega IG Business/Creator:
   * 1) /me/accounts (User token)
   * 2) /{pageId}?fields=instagram_business_account (Page token)
   * 3) /{igUserId}?fields=id,username (Page token)
   */
  async getMe(userAccessToken: string): Promise<MeResponse> {
    try {
      // 1) páginas do usuário
      const pagesRes = await this.http.get("/me/accounts", {
        params: {
          fields: "id,name,access_token",
          access_token: userAccessToken
        }
      });

      const pages = (pagesRes.data?.data ?? []) as PageItem[];
      if (!pages.length) {
        throw new Error(
          "Nenhuma Página do Facebook encontrada (/me/accounts vazio). " +
            "Verifique se a conta tem uma Página e se o app tem pages_show_list."
        );
      }

      // 2) tenta achar uma página que realmente tenha instagram_business_account
      for (const p of pages) {
        if (!p?.id || !p.access_token) continue;

        const pageId = p.id;
        const pageAccessToken = p.access_token;

        const igLinkRes = await this.http.get(`/${pageId}`, {
          params: {
            fields: "instagram_business_account",
            access_token: pageAccessToken
          }
        });

        const igUserId = igLinkRes.data?.instagram_business_account?.id as string | undefined;
        if (!igUserId) continue;

        // 3) dados do perfil IG (IGUser não tem account_type no Graph API)
        const igProfileRes = await this.http.get(`/${igUserId}`, {
          params: {
            fields: "id,username",
            access_token: pageAccessToken
          }
        });

        const data = igProfileRes.data as { id: string; username: string };

        return {
          igUserId: data.id,
          username: data.username,
          accountType: "IG_USER", // valor fixo pra manter compatibilidade
          facebookPageId: pageId,
          pageAccessToken
        };
      }

      throw new Error(
        "Nenhuma Página retornou instagram_business_account. " +
          "Você precisa vincular uma conta Instagram Business/Creator a uma Página do Facebook."
      );
    } catch (e) {
      throw this.wrapAxios(e, "getMe");
    }
  }

  private wrapAxios(err: unknown, where: string): Error {
    if (axios.isAxiosError(err)) {
      const ae = err as AxiosError<any>;
      const status = ae.response?.status;
      const data = ae.response?.data;
      return new Error(
        `Instagram/Facebook API error (${where}) status=${status} body=${JSON.stringify(data)}`
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
