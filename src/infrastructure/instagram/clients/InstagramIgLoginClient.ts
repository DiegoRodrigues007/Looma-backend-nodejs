import axios, { AxiosError, AxiosInstance } from "axios";
import crypto from "crypto";

/* =========================
   Types
========================= */

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
  accountType: string; // BUSINESS | CREATOR | etc (quando disponível)
  facebookPageId?: string;
  pageAccessToken?: string;
}

/**
 * ✅ Novo: candidato encontrado para o usuário escolher no frontend
 * - Pode ser Business (instagram_business_account) ou Creator (connected_instagram_account)
 */
export type IgCandidate = {
  igUserId: string;
  username: string;
  accountType: string;
  facebookPageId: string;
  facebookPageName?: string;
  pageAccessToken: string; // necessário pra usar Graph IG endpoints e salvar
  source: "instagram_business_account" | "connected_instagram_account";
};

type PageItem = {
  id: string;
  name?: string;
  access_token?: string;
};

type PermissionItem = {
  permission: string;
  status: "granted" | "declined";
};

type BusinessItem = {
  id: string;
  name?: string;
};

type DebugTokenResponse = {
  data?: {
    app_id?: string;
    type?: string;
    application?: string;
    user_id?: string;
    is_valid?: boolean;
    expires_at?: number;
    scopes?: string[];
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  };
};

/* =========================
   Client
========================= */

export class InstagramIgLoginClient {
  private http: AxiosInstance;

  private graphBaseUrl =
    process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";
  private authUrl =
    process.env.INSTAGRAM_AUTH_URL ??
    "https://www.facebook.com/v21.0/dialog/oauth";
  private tokenUrl =
    process.env.INSTAGRAM_TOKEN_URL ??
    "https://graph.facebook.com/v21.0/oauth/access_token";

  private clientId = process.env.INSTAGRAM_CLIENT_ID!;
  private clientSecret = process.env.INSTAGRAM_CLIENT_SECRET!;
  private redirectUri = process.env.INSTAGRAM_REDIRECT_URI!;

  /**
   * ✅ Logs control:
   * - IG_DEBUG_LOGS=true | 1
   * - IG_DEBUG_LOGS_LEVEL=debug|info|warn|error (default=debug)
   */
  private debugLogsEnabled =
    String(process.env.IG_DEBUG_LOGS ?? "").trim().toLowerCase() === "true" ||
    String(process.env.IG_DEBUG_LOGS ?? "").trim() === "1";

  private logLevel = String(process.env.IG_DEBUG_LOGS_LEVEL ?? "debug")
    .trim()
    .toLowerCase();

  private scopes = (
    process.env.INSTAGRAM_SCOPES ??
    [
      "public_profile",
      "email",
      "pages_show_list",
      "pages_read_engagement",
      "pages_read_user_content",
      "instagram_basic",
      "instagram_manage_insights",
      "business_management",
    ].join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");

  constructor() {
    this.http = axios.create({
      baseURL: this.graphBaseUrl,
      timeout: 15000,
    });

    // ✅ Startup logs (config)
    this.log("info", "client:init", {
      graphBaseUrl: this.graphBaseUrl,
      authUrl: this.authUrl,
      tokenUrl: this.tokenUrl,
      redirectUri: this.redirectUri,
      scopes: this.scopes,
      debugLogsEnabled: this.debugLogsEnabled,
      logLevel: this.logLevel,
      hasClientId: !!this.clientId,
      hasClientSecret: !!this.clientSecret,
    });

    // ✅ Interceptors (request/response)
    this.http.interceptors.request.use(
      (config) => {
        const rid = this.getOrCreateRequestId(config);
        this.log("debug", "http:request", {
          rid,
          method: config.method,
          baseURL: config.baseURL,
          url: config.url,
          params: this.maskSensitiveParams(config.params),
          timeout: config.timeout,
        });
        return config;
      },
      (error) => {
        this.log("error", "http:request:error", {
          err: error instanceof Error ? error.message : String(error),
        });
        return Promise.reject(error);
      }
    );

    this.http.interceptors.response.use(
      (response) => {
        const rid = this.getOrCreateRequestId(response.config);
        this.log("debug", "http:response", {
          rid,
          status: response.status,
          url: response.config?.url,
          dataPreview: this.previewJson(response.data),
        });
        return response;
      },
      (error) => {
        const ae = axios.isAxiosError(error) ? (error as AxiosError<any>) : null;
        const rid = ae?.config ? this.getOrCreateRequestId(ae.config) : "unknown";
        this.log("warn", "http:response:error", {
          rid,
          status: ae?.response?.status,
          url: ae?.config?.url,
          params: this.maskSensitiveParams(ae?.config?.params),
          bodyPreview: this.previewJson(ae?.response?.data),
          err: error instanceof Error ? error.message : String(error),
        });
        return Promise.reject(error);
      }
    );
  }

  /* =========================
     Logging helpers
  ========================= */

  private maskToken(t?: string | null) {
    if (!t) return null;
    const s = String(t);
    if (s.length <= 12) return `${s.slice(0, 4)}…`;
    return `${s.slice(0, 7)}…${s.slice(-4)}`;
  }

  private maskSensitiveParams(params: any) {
    if (!params || typeof params !== "object") return params;
    const copy: any = { ...params };
    if (copy.access_token) copy.access_token = this.maskToken(copy.access_token);
    if (copy.input_token) copy.input_token = this.maskToken(copy.input_token);
    if (copy.fb_exchange_token)
      copy.fb_exchange_token = this.maskToken(copy.fb_exchange_token);
    if (copy.client_secret) copy.client_secret = "****";
    if (copy.code) copy.code = copy.code ? "****" : copy.code;
    return copy;
  }

  private previewJson(data: any, max = 900) {
    try {
      const s = JSON.stringify(data);
      if (!s) return s;
      return s.length > max ? s.slice(0, max - 1) + "…" : s;
    } catch {
      return String(data);
    }
  }

  private shouldLog(level: "debug" | "info" | "warn" | "error") {
    const order = { debug: 10, info: 20, warn: 30, error: 40 } as const;
    const current =
      (order[this.logLevel as keyof typeof order] ?? order.debug) as number;
    return order[level] >= current;
  }

  private log(level: "debug" | "info" | "warn" | "error", msg: string, obj?: any) {
    if (!this.debugLogsEnabled) return;
    if (!this.shouldLog(level)) return;

    const prefix = `[IG][${level.toUpperCase()}] ${msg}`;
    try {
      if (obj !== undefined) console.log(prefix, obj);
      else console.log(prefix);
    } catch {
      // noop
    }
  }

  private getOrCreateRequestId(config: any): string {
    try {
      const headers = (config.headers ??= {});
      const current = headers["x-ig-rid"] || headers["X-IG-RID"];
      if (current) return String(current);
      const rid = crypto.randomBytes(6).toString("hex");
      headers["x-ig-rid"] = rid;
      return rid;
    } catch {
      return "no-rid";
    }
  }

  private nowMs() {
    return Date.now();
  }

  private msSince(startMs: number) {
    return this.nowMs() - startMs;
  }

  /* =========================
     OAuth URL
  ========================= */

  buildLoginUrl(state: string, forceReRequest = false): string {
    this.log("info", "oauth:buildLoginUrl:start", {
      forceReRequest,
      scopes: this.scopes,
      redirectUri: this.redirectUri,
      authUrl: this.authUrl,
      statePreview: state ? `${state.slice(0, 6)}…` : null,
    });

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: this.scopes,
      response_type: "code",
      state,
    });

    if (forceReRequest) params.set("auth_type", "rerequest");

    const url = `${this.authUrl}?${params.toString()}`;

    this.log("info", "oauth:buildLoginUrl:done", {
      urlPreview: url.slice(0, 220) + (url.length > 220 ? "…" : ""),
    });

    return url;
  }

  /* =========================
     Token exchange
  ========================= */

  async exchangeCodeForShortToken(code: string): Promise<ShortTokenResponse> {
    const started = this.nowMs();
    try {
      this.log("info", "token:exchangeCodeForShortToken:start", {
        tokenUrl: this.tokenUrl,
        redirectUri: this.redirectUri,
        clientIdPreview: (this.clientId ?? "").slice(0, 6) + "…",
        hasCode: !!code,
      });

      const res = await axios.get(this.tokenUrl, {
        params: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
          code,
        },
      });

      const data = res.data as { access_token: string };

      this.log("info", "token:exchangeCodeForShortToken:ok", {
        shortToken: this.maskToken(data.access_token),
        tookMs: this.msSince(started),
      });

      return { shortToken: data.access_token, userId: null };
    } catch (e) {
      this.log("error", "token:exchangeCodeForShortToken:failed", {
        tookMs: this.msSince(started),
        err: e instanceof Error ? e.message : String(e),
      });
      throw this.wrapAxios(e, "exchangeCodeForShortToken");
    }
  }

  async exchangeShortForLong(shortToken: string): Promise<LongTokenResponse> {
    const started = this.nowMs();
    try {
      this.log("info", "token:exchangeShortForLong:start", {
        tokenUrl: this.tokenUrl,
        shortToken: this.maskToken(shortToken),
      });

      const res = await axios.get(this.tokenUrl, {
        params: {
          // ✅ troca SHORT -> LONG
          grant_type: "fb_exchange_token",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          fb_exchange_token: shortToken,
        },
      });

      const data = res.data as { access_token: string; expires_in?: number };

      const expiresAt =
        data.expires_in != null
          ? new Date(Date.now() + data.expires_in * 1000)
          : undefined;

      this.log("info", "token:exchangeShortForLong:ok", {
        longToken: this.maskToken(data.access_token),
        expires_in: data.expires_in,
        expiresAt: expiresAt?.toISOString(),
        tookMs: this.msSince(started),
      });

      return { longToken: data.access_token, expiresAt };
    } catch (e) {
      this.log("error", "token:exchangeShortForLong:failed", {
        shortToken: this.maskToken(shortToken),
        tookMs: this.msSince(started),
        err: e instanceof Error ? e.message : String(e),
      });
      throw this.wrapAxios(e, "exchangeShortForLong");
    }
  }

  /**
   * ✅ Refresh correto do LONG token (Graph API)
   * - grant_type=fb_long_lived_token
   */
  async refreshLong(longToken: string): Promise<string> {
    const started = this.nowMs();
    try {
      this.log("info", "token:refreshLong:start", {
        longToken: this.maskToken(longToken),
        tokenUrl: this.tokenUrl,
      });

      const res = await axios.get(this.tokenUrl, {
        params: {
          grant_type: "fb_long_lived_token",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          fb_exchange_token: longToken,
        },
      });

      const data = res.data as { access_token: string };

      this.log("info", "token:refreshLong:ok", {
        newLongToken: this.maskToken(data.access_token),
        tookMs: this.msSince(started),
      });

      return data.access_token;
    } catch (e) {
      this.log("error", "token:refreshLong:failed", {
        longToken: this.maskToken(longToken),
        tookMs: this.msSince(started),
        err: e instanceof Error ? e.message : String(e),
      });
      throw this.wrapAxios(e, "refreshLong");
    }
  }

  /* =========================
     Permissions (debug)
  ========================= */

  async getGrantedPermissions(userAccessToken: string): Promise<Set<string>> {
    const started = this.nowMs();
    try {
      this.log("info", "perms:/me/permissions:start", {
        token: this.maskToken(userAccessToken),
      });

      const res = await this.http.get("/me/permissions", {
        params: { access_token: userAccessToken },
      });

      const perms = (res.data?.data ?? []) as PermissionItem[];

      const granted = perms
        .filter((p) => p.status === "granted")
        .map((p) => p.permission);
      const declined = perms
        .filter((p) => p.status === "declined")
        .map((p) => p.permission);

      this.log("info", "perms:/me/permissions:ok", {
        granted,
        declined,
        rawCount: perms.length,
        tookMs: this.msSince(started),
      });

      return new Set(granted);
    } catch (e) {
      this.log("error", "perms:/me/permissions:failed", {
        token: this.maskToken(userAccessToken),
        tookMs: this.msSince(started),
        err: e instanceof Error ? e.message : String(e),
      });
      throw this.wrapAxios(e, "getGrantedPermissions");
    }
  }

  hasRequiredPermissions(granted: Set<string>): boolean {
    const required = [
      "pages_show_list",
      "instagram_basic",
      "instagram_manage_insights",
    ];
    const missing = required.filter((p) => !granted.has(p));

    this.log("info", "perms:hasRequiredPermissions", {
      required,
      ok: missing.length === 0,
      missing,
      grantedPreview: Array.from(granted).slice(0, 50),
    });

    return missing.length === 0;
  }

  /* =========================
     debug_token (RETORNA selectedPageIds)
  ========================= */

  private async debugToken(userAccessToken: string): Promise<string[]> {
    const started = this.nowMs();
    try {
      const appToken = `${this.clientId}|${this.clientSecret}`;

      this.log("info", "debug:/debug_token:start", {
        token: this.maskToken(userAccessToken),
      });

      const res = await this.http.get<DebugTokenResponse>("/debug_token", {
        params: {
          input_token: userAccessToken,
          access_token: appToken,
        },
      });

      const gs = res.data?.data?.granular_scopes ?? [];
      const pagesScope = gs.find((x) => x.scope === "pages_show_list");
      const selectedPageIds = (pagesScope?.target_ids ?? []).filter(Boolean);

      this.log("info", "debug:/debug_token:ok", {
        is_valid: res.data?.data?.is_valid,
        user_id: res.data?.data?.user_id,
        app_id: res.data?.data?.app_id,
        type: res.data?.data?.type,
        scopes: res.data?.data?.scopes,
        granular_scopes: res.data?.data?.granular_scopes,
        expires_at: res.data?.data?.expires_at,
        tookMs: this.msSince(started),
      });

      this.log("info", "debug:/debug_token:pages_show_list targets", {
        count: selectedPageIds.length,
        target_ids: selectedPageIds,
      });

      return selectedPageIds;
    } catch (e) {
      this.log("warn", "debug:/debug_token:failed (ignored)", {
        tookMs: this.msSince(started),
        err: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  }

  /* =========================
     IMPORTANT:
     - se não vier page access token, buscamos via /{pageId}?fields=access_token usando user token
  ========================= */

  private async getPageAccessToken(opts: {
    pageId: string;
    pageName?: string;
    userAccessToken: string;
    existingPageToken?: string;
  }): Promise<string | null> {
    const started = this.nowMs();
    const { pageId, pageName, userAccessToken, existingPageToken } = opts;

    this.log("debug", "pageToken:getPageAccessToken:start", {
      pageId,
      pageName,
      hasExistingPageToken: !!existingPageToken,
      userToken: this.maskToken(userAccessToken),
    });

    if (existingPageToken && String(existingPageToken).trim().length > 0) {
      this.log("debug", "pageToken:getPageAccessToken:using-existing", {
        pageId,
        pageName,
        pageToken: this.maskToken(existingPageToken),
        tookMs: this.msSince(started),
      });
      return existingPageToken;
    }

    this.log("info", "pageToken:getPageAccessToken:fetching", {
      pageId,
      pageName,
      using: "userAccessToken",
      fields: "access_token,name",
    });

    try {
      const res = await this.http.get(`/${pageId}`, {
        params: {
          fields: "access_token,name",
          access_token: userAccessToken,
        },
      });

      const token = res.data?.access_token as string | undefined;

      this.log("info", "pageToken:getPageAccessToken:fetched", {
        pageId,
        pageName: res.data?.name ?? pageName,
        hasToken: !!token,
        pageToken: this.maskToken(token),
        tookMs: this.msSince(started),
      });

      return token && token.trim().length > 0 ? token : null;
    } catch (e) {
      const ax = axios.isAxiosError(e) ? (e as AxiosError<any>) : null;
      this.log("warn", "pageToken:getPageAccessToken:failed", {
        pageId,
        pageName,
        status: ax?.response?.status,
        bodyPreview: this.previewJson(ax?.response?.data),
        err: e instanceof Error ? e.message : String(e),
        tookMs: this.msSince(started),
      });
      return null;
    }
  }

  /* =========================
     Internal: fetch pages
     ✅ pagina /me/accounts
     ✅ garante TODAS as páginas selecionadas (debug_token target_ids)
     ✅ fallback Business Manager se necessário
  ========================= */

  private async fetchPages(userAccessToken: string): Promise<PageItem[]> {
    const started = this.nowMs();

    // ✅ 0) páginas selecionadas no consentimento (pode vir 1..N)
    const selectedPageIds = await this.debugToken(userAccessToken);

    // 1) tenta /me/accounts COM PAGINAÇÃO
    this.log("info", "pages:/me/accounts:start", {
      token: this.maskToken(userAccessToken),
      fields: "id,name,access_token",
      mode: "paginated",
    });

    const collected: PageItem[] = [];
    let after: string | undefined = undefined;

    for (let guard = 0; guard < 20; guard++) {
      try {
        const pagesRes = await this.http.get("/me/accounts", {
          params: {
            fields: "id,name,access_token",
            limit: 100,
            after,
            access_token: userAccessToken,
          },
        });

        this.log("debug", "pages:/me/accounts:raw", {
          dataPreview: this.previewJson(pagesRes.data),
        });

        const batch = (pagesRes.data?.data ?? []) as PageItem[];
        if (batch.length) collected.push(...batch);

        const nextAfter = pagesRes.data?.paging?.cursors?.after as
          | string
          | undefined;
        if (!nextAfter || nextAfter === after) break;
        after = nextAfter;

        // se já pegamos todas as selecionadas, para cedo
        if (selectedPageIds.length) {
          const have = new Set(collected.map((p) => p.id));
          const missing = selectedPageIds.filter((id) => !have.has(id));
          if (missing.length === 0) break;
        }
      } catch (e) {
        const ax = axios.isAxiosError(e) ? (e as AxiosError<any>) : null;
        this.log("warn", "pages:/me/accounts:page:failed", {
          status: ax?.response?.status,
          bodyPreview: this.previewJson(ax?.response?.data),
          err: e instanceof Error ? e.message : String(e),
        });
        break;
      }
    }

    // dedup
    const uniq = new Map<string, PageItem>();
    for (const p of collected) if (p?.id && !uniq.has(p.id)) uniq.set(p.id, p);

    let pages = Array.from(uniq.values());

    this.log("info", "pages:/me/accounts:parsed", {
      pagesCount: pages.length,
      pagesPreview: pages
        .slice(0, 25)
        .map((p) => ({ id: p.id, name: p.name, hasToken: !!p.access_token })),
      tookMs: this.msSince(started),
    });

    // 2) FALLBACK: Business Manager (se vier 0)
    if (!pages.length) {
      this.log(
        "warn",
        "pages:fallback:/me/accounts empty -> trying /me/businesses",
        {
          token: this.maskToken(userAccessToken),
        }
      );

      const bStarted = this.nowMs();
      const businessesRes = await this.http.get("/me/businesses", {
        params: { fields: "id,name", access_token: userAccessToken },
      });

      const businesses = (businessesRes.data?.data ?? []) as BusinessItem[];

      this.log("info", "pages:/me/businesses:ok", {
        count: businesses.length,
        preview: businesses
          .slice(0, 10)
          .map((b) => ({ id: b.id, name: b.name })),
        tookMs: this.msSince(bStarted),
      });

      const bmCollected: PageItem[] = [];

      for (const biz of businesses) {
        if (!biz?.id) continue;

        // owned_pages
        const ownedStarted = this.nowMs();
        try {
          const ownedRes = await this.http.get(`/${biz.id}/owned_pages`, {
            params: {
              fields: "id,name,access_token",
              access_token: userAccessToken,
            },
          });

          const owned = (ownedRes.data?.data ?? []) as PageItem[];
          this.log("info", "pages:owned_pages:ok", {
            bizId: biz.id,
            count: owned.length,
            preview: owned
              .slice(0, 10)
              .map((p) => ({
                id: p.id,
                name: p.name,
                hasToken: !!p.access_token,
              })),
            tookMs: this.msSince(ownedStarted),
          });
          bmCollected.push(...owned);
        } catch (e) {
          this.log("warn", "pages:owned_pages:failed", {
            bizId: biz.id,
            err: e instanceof Error ? e.message : String(e),
            tookMs: this.msSince(ownedStarted),
          });
        }

        // client_pages
        const clientStarted = this.nowMs();
        try {
          const clientRes = await this.http.get(`/${biz.id}/client_pages`, {
            params: {
              fields: "id,name,access_token",
              access_token: userAccessToken,
            },
          });

          const clientPages = (clientRes.data?.data ?? []) as PageItem[];
          this.log("info", "pages:client_pages:ok", {
            bizId: biz.id,
            count: clientPages.length,
            preview: clientPages
              .slice(0, 10)
              .map((p) => ({
                id: p.id,
                name: p.name,
                hasToken: !!p.access_token,
              })),
            tookMs: this.msSince(clientStarted),
          });
          bmCollected.push(...clientPages);
        } catch (e) {
          this.log("warn", "pages:client_pages:failed", {
            bizId: biz.id,
            err: e instanceof Error ? e.message : String(e),
            tookMs: this.msSince(clientStarted),
          });
        }
      }

      // dedup bmCollected
      const bmUniq = new Map<string, PageItem>();
      for (const p of bmCollected)
        if (p?.id && !bmUniq.has(p.id)) bmUniq.set(p.id, p);

      pages = Array.from(bmUniq.values());

      this.log("info", "pages:fallback:collected via Business Manager", {
        count: pages.length,
        preview: pages
          .slice(0, 20)
          .map((p) => ({ id: p.id, name: p.name, hasToken: !!p.access_token })),
        tookMs: this.msSince(started),
      });
    }

    // 3) ✅ GARANTIR TODAS AS SELECIONADAS:
    // se /me/accounts (ou BM fallback) não trouxe tudo, busca por id individualmente
    if (selectedPageIds.length) {
      const have = new Set(pages.map((p) => p.id));
      const missingIds = selectedPageIds.filter((id) => !have.has(id));

      if (missingIds.length) {
        this.log("warn", "pages:selected:missing -> fetching-by-id", {
          missingCount: missingIds.length,
          missingIds: missingIds.slice(0, 50),
        });

        for (const pageId of missingIds) {
          try {
            const res = await this.http.get(`/${pageId}`, {
              params: {
                fields: "id,name,access_token",
                access_token: userAccessToken,
              },
            });

            const item: PageItem = {
              id: String(res.data?.id ?? pageId),
              name: res.data?.name,
              access_token: res.data?.access_token,
            };

            if (item.id && !have.has(item.id)) {
              pages.push(item);
              have.add(item.id);
            }
          } catch (e) {
            const ax = axios.isAxiosError(e) ? (e as AxiosError<any>) : null;
            this.log("warn", "pages:selected:fetch-by-id:failed (ignored)", {
              pageId,
              status: ax?.response?.status,
              bodyPreview: this.previewJson(ax?.response?.data),
              err: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      // ✅ IMPORTANTÍSSIMO: retornar APENAS as páginas selecionadas
      const selectedSet = new Set(selectedPageIds);
      pages = pages.filter((p) => selectedSet.has(p.id));

      this.log("info", "pages:selected:final", {
        selectedCount: pages.length,
        selectedIds: pages.map((p) => p.id).slice(0, 50),
        preview: pages
          .slice(0, 20)
          .map((p) => ({ id: p.id, name: p.name, hasToken: !!p.access_token })),
      });
    }

    return pages;
  }

  /* =========================
     ✅ Lista candidatos IG para o usuário escolher
     ✅ FIX: IGUser NÃO tem campo account_type -> remover para não dar 400
     ✅ Tipo da conta vem do "source" (business vs connected)
  ========================= */

  async getCandidates(userAccessToken: string): Promise<IgCandidate[]> {
    const started = this.nowMs();
    const flowId = crypto.randomBytes(6).toString("hex"); // correlação do fluxo inteiro

    this.log("info", "candidates:getCandidates:start", {
      flowId,
      token: this.maskToken(userAccessToken),
    });

    try {
      // já retorna selectedPageIds e loga granular scopes
      await this.debugToken(userAccessToken);

      // (opcional) inspeciona permissões no início
      try {
        const granted = await this.getGrantedPermissions(userAccessToken);
        this.hasRequiredPermissions(granted);
      } catch (e) {
        this.log("warn", "candidates:permissions-check:failed (ignored)", {
          flowId,
          err: e instanceof Error ? e.message : String(e),
        });
      }

      const pages = await this.fetchPages(userAccessToken);

      if (!pages.length) {
        this.log("error", "candidates:no-pages", { flowId });
        throw new Error(
          "Nenhuma Página encontrada. /me/accounts veio vazio e não achamos páginas via Business Manager. " +
            "Sem páginas acessíveis, não é possível resolver contas do Instagram vinculadas."
        );
      }

      const candidates: IgCandidate[] = [];
      const dedup = new Set<string>(); // chave: igUserId|pageId

      this.log("info", "candidates:pages:loop:start", {
        flowId,
        pagesCount: pages.length,
        pagesPreview: pages.slice(0, 25).map((p) => ({
          id: p.id,
          name: p.name,
          hasToken: !!p.access_token,
        })),
      });

      for (const p of pages) {
        if (!p?.id) continue;

        const pageId = p.id;
        const pageName = p.name;

        this.log("debug", "candidates:page:start", {
          flowId,
          pageId,
          pageName,
          hasInlinePageToken: !!p.access_token,
        });

        const pageAccessToken = await this.getPageAccessToken({
          pageId,
          pageName,
          userAccessToken,
          existingPageToken: p.access_token,
        });

        this.log("debug", "candidates:page:pageAccessToken:resolved", {
          flowId,
          pageId,
          pageName,
          hasPageToken: !!pageAccessToken,
          pageToken: this.maskToken(pageAccessToken),
        });

        if (!pageAccessToken) {
          this.log("warn", "candidates:page:skipping-no-page-token", {
            flowId,
            pageId,
            pageName,
          });
          continue;
        }

        // ✅ link IG via página (BUSINESS ou CREATOR)
        let igLinkRes: any;
        const linkStarted = this.nowMs();
        try {
          this.log("info", "candidates:page:ig-link:request", {
            flowId,
            pageId,
            pageName,
            fields: "instagram_business_account,connected_instagram_account",
          });

          igLinkRes = await this.http.get(`/${pageId}`, {
            params: {
              fields: "instagram_business_account,connected_instagram_account",
              access_token: pageAccessToken,
            },
          });

          this.log("info", "candidates:page:ig-link:ok", {
            flowId,
            pageId,
            pageName,
            dataPreview: this.previewJson(igLinkRes?.data),
            tookMs: this.msSince(linkStarted),
          });
        } catch (e) {
          const ax = axios.isAxiosError(e) ? (e as AxiosError<any>) : null;
          this.log("warn", "candidates:page:ig-link:failed (ignored)", {
            flowId,
            pageId,
            pageName,
            status: ax?.response?.status,
            bodyPreview: this.previewJson(ax?.response?.data),
            err: e instanceof Error ? e.message : String(e),
            tookMs: this.msSince(linkStarted),
          });
          continue;
        }

        const igBusinessId = igLinkRes?.data?.instagram_business_account?.id as
          | string
          | undefined;
        const igConnectedId = igLinkRes?.data?.connected_instagram_account?.id as
          | string
          | undefined;

        const igUserId = (igBusinessId ?? igConnectedId) as string | undefined;
        const source: IgCandidate["source"] = igBusinessId
          ? "instagram_business_account"
          : "connected_instagram_account";

        this.log("debug", "candidates:page:ig-link:parsed", {
          flowId,
          pageId,
          pageName,
          igBusinessId: igBusinessId ?? null,
          igConnectedId: igConnectedId ?? null,
          chosenIgUserId: igUserId ?? null,
          source,
        });

        if (!igUserId) {
          this.log("warn", "candidates:page:no-ig-linked", {
            flowId,
            pageId,
            pageName,
          });
          continue;
        }

        // ✅ perfil IG (FIX: sem account_type)
        let igProfileRes: any;
        const profileStarted = this.nowMs();
        try {
          this.log("info", "candidates:ig-profile:request", {
            flowId,
            pageId,
            pageName,
            igUserId,
            fields: "id,username",
          });

          igProfileRes = await this.http.get(`/${igUserId}`, {
            params: {
              fields: "id,username",
              access_token: pageAccessToken,
            },
          });

          this.log("info", "candidates:ig-profile:ok", {
            flowId,
            pageId,
            pageName,
            igUserId,
            dataPreview: this.previewJson(igProfileRes?.data),
            tookMs: this.msSince(profileStarted),
          });
        } catch (e) {
          const ax = axios.isAxiosError(e) ? (e as AxiosError<any>) : null;
          this.log("warn", "candidates:ig-profile:failed (ignored)", {
            flowId,
            pageId,
            pageName,
            igUserId,
            status: ax?.response?.status,
            bodyPreview: this.previewJson(ax?.response?.data),
            err: e instanceof Error ? e.message : String(e),
            tookMs: this.msSince(profileStarted),
          });
          continue;
        }

        const profile = igProfileRes.data as { id: string; username: string };

        const key = `${profile.id}|${pageId}`;
        if (dedup.has(key)) {
          this.log("debug", "candidates:dedup:skip", {
            flowId,
            key,
            igUserId: profile.id,
            pageId,
          });
          continue;
        }
        dedup.add(key);

        const candidate: IgCandidate = {
          igUserId: profile.id,
          username: profile.username,
          accountType:
            source === "instagram_business_account" ? "BUSINESS" : "CREATOR",
          facebookPageId: pageId,
          facebookPageName: pageName,
          pageAccessToken,
          source,
        };

        candidates.push(candidate);

        this.log("info", "candidates:added", {
          flowId,
          igUserId: candidate.igUserId,
          username: candidate.username,
          accountType: candidate.accountType,
          pageId: candidate.facebookPageId,
          pageName: candidate.facebookPageName,
          source: candidate.source,
        });
      }

      this.log("info", "candidates:getCandidates:done", {
        flowId,
        count: candidates.length,
        preview: candidates.slice(0, 10).map((c) => ({
          igUserId: c.igUserId,
          username: c.username,
          accountType: c.accountType,
          pageId: c.facebookPageId,
          pageName: c.facebookPageName,
          source: c.source,
          pageToken: this.maskToken(c.pageAccessToken),
        })),
        tookMs: this.msSince(started),
      });

      return candidates;
    } catch (e) {
      this.log("error", "candidates:getCandidates:failed", {
        flowId,
        tookMs: this.msSince(started),
        err: e instanceof Error ? e.stack || e.message : String(e),
      });
      throw this.wrapAxios(e, "getCandidates");
    }
  }

  /* =========================
     Compat: getMe() retorna 1 (primeiro candidato)
     -> Use getCandidates() pro fluxo novo
  ========================= */

  async getMe(userAccessToken: string): Promise<MeResponse> {
    const started = this.nowMs();
    this.log("info", "me:getMe:start", {
      token: this.maskToken(userAccessToken),
    });

    const candidates = await this.getCandidates(userAccessToken);

    if (!candidates.length) {
      this.log("error", "me:getMe:no-candidates", {
        tookMs: this.msSince(started),
      });

      throw new Error(
        "Nenhuma Página retornou instagram_business_account OU connected_instagram_account. " +
          "A conta do Instagram precisa ser Professional (Business/Creator) e estar vinculada a uma Página " +
          "que o usuário do Facebook logado consiga acessar."
      );
    }

    const first = candidates[0];

    this.log("info", "me:getMe:ok", {
      igUserId: first.igUserId,
      username: first.username,
      accountType: first.accountType,
      facebookPageId: first.facebookPageId,
      tookMs: this.msSince(started),
    });

    return {
      igUserId: first.igUserId,
      username: first.username,
      accountType: first.accountType,
      facebookPageId: first.facebookPageId,
      pageAccessToken: first.pageAccessToken,
    };
  }

  /* =========================
     Error helper
  ========================= */

  private wrapAxios(err: unknown, where: string): Error {
    if (axios.isAxiosError(err)) {
      const ae = err as AxiosError<any>;
      const status = ae.response?.status;
      const data = ae.response?.data;

      this.log("error", "wrapAxios", {
        where,
        status,
        bodyPreview: this.previewJson(data),
        message: ae.message,
      });

      return new Error(
        `Instagram/Facebook API error (${where}) status=${status} body=${JSON.stringify(
          data
        )}`
      );
    }

    const msg = err instanceof Error ? err.message : String(err);

    this.log("error", "wrapAxios:non-axios", {
      where,
      err: msg,
    });

    return err instanceof Error ? err : new Error(String(err));
  }
}