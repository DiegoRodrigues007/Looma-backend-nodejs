import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import type {
  IYouTubeAuthService,
  YouTubeChannelInfo,
  YouTubeTokenPayload,
  YouTubeTopContentItem,
} from "../../application/ports/youtube/IYouTubeAuthService";

function required(name: string, value?: string) {
  if (!value || !value.trim()) throw new Error(`Env ${name} é obrigatório`);
  return value.trim();
}

function parseNumber(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export class GoogleYouTubeAuthService implements IYouTubeAuthService {
  private oauth: OAuth2Client;

  private clientId = required("YOUTUBE_CLIENT_ID", process.env.YOUTUBE_CLIENT_ID);
  private clientSecret = required("YOUTUBE_CLIENT_SECRET", process.env.YOUTUBE_CLIENT_SECRET);
  private redirectUri = required("YOUTUBE_REDIRECT_URI", process.env.YOUTUBE_REDIRECT_URI);

  private scopes = (
    process.env.YOUTUBE_SCOPES ??
    "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly"
  )
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);

  constructor() {
    this.oauth = new OAuth2Client({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      redirectUri: this.redirectUri,
    });
  }

  buildLoginUrl(state: string): string {
    return this.oauth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: this.scopes,
      state,
    });
  }

  async exchangeCodeForTokens(code: string): Promise<YouTubeTokenPayload> {
    const { tokens } = await this.oauth.getToken(code);

    const accessToken = tokens.access_token;
    if (!accessToken) throw new Error("Google OAuth não retornou access_token");

    return {
      accessToken,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: typeof tokens.expiry_date === "number" ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope ?? null,
    };
  }

  async refreshAccessToken(
    refreshToken: string
  ): Promise<Pick<YouTubeTokenPayload, "accessToken" | "expiresAt">> {
    // usa o mesmo oauth client (melhor chance de obter expiry_date)
    this.oauth.setCredentials({ refresh_token: refreshToken });

    // A google-auth-library tem variações: refreshAccessToken() / refreshToken()
    // Vamos tentar refreshAccessToken primeiro e fallback pro getAccessToken.
    try {
      // @ts-ignore (assinatura pode variar dependendo da versão)
      const res = await this.oauth.refreshAccessToken();
      const tokens = res?.credentials ?? res;

      const accessToken = tokens?.access_token;
      if (!accessToken) throw new Error("Falha ao renovar access token do Google (sem access_token)");

      const expiresAt =
        typeof tokens?.expiry_date === "number" ? new Date(tokens.expiry_date) : null;

      return { accessToken, expiresAt };
    } catch {
      // fallback: getAccessToken (às vezes não vem expiry_date)
      const res = await this.oauth.getAccessToken();
      const accessToken = res?.token;
      if (!accessToken) throw new Error("Falha ao renovar access token do Google");

      return { accessToken, expiresAt: null };
    }
  }

  async getMyChannel(accessToken: string): Promise<YouTubeChannelInfo> {
    const res = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
      params: { part: "snippet,statistics", mine: true },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    });

    const item = res.data?.items?.[0];
    if (!item?.id) {
      throw new Error("Não foi possível identificar o channelId (channels.list mine=true vazio)");
    }

    const snippet = item.snippet ?? {};
    const stats = item.statistics ?? {};

    return {
      channelId: String(item.id),
      title: snippet.title ?? null,
      handle: snippet.customUrl ?? null,
      subscribers: parseNumber(stats.subscriberCount),
      views: parseNumber(stats.viewCount),
      videos: parseNumber(stats.videoCount),
    };
  }

  async getAnalyticsDaily(opts: { accessToken: string; from: string; to: string }) {
    const { accessToken, from, to } = opts;

    const res = await axios.get("https://youtubeanalytics.googleapis.com/v2/reports", {
      params: {
        ids: "channel==MINE",
        startDate: from,
        endDate: to,
        metrics: [
          "views",
          "estimatedMinutesWatched",
          "averageViewDuration",
          "subscribersGained",
          "subscribersLost",
        ].join(","),
        dimensions: "day",
        sort: "day",
      },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 20000,
    });

    const rows = (res.data?.rows ?? []) as any[];

    return {
      rows: rows.map((r) => ({
        day: String(r[0]),
        views: Number(r[1] ?? 0),
        estimatedMinutesWatched: Number(r[2] ?? 0),
        averageViewDuration: Number(r[3] ?? 0),
        subscribersGained: Number(r[4] ?? 0),
        subscribersLost: Number(r[5] ?? 0),
      })),
    };
  }

  // ==========================
  // ✅ TOP CONTENT (NOVO)
  // ==========================
  async getTopContent(opts: {
    accessToken: string;
    from: string;
    to: string;
    limit: number;
  }): Promise<{ items: YouTubeTopContentItem[] }> {
    const { accessToken, from, to } = opts;
    const limitSafe = Math.min(Math.max(Number(opts.limit) || 10, 1), 25);

    // 1) Analytics rank por vídeo
    const fetchAnalytics = async (withEngagement: boolean) => {
      const metrics = withEngagement
        ? ["views", "estimatedMinutesWatched", "averageViewDuration", "likes", "comments"]
        : ["views", "estimatedMinutesWatched", "averageViewDuration"];

      return axios.get("https://youtubeanalytics.googleapis.com/v2/reports", {
        params: {
          ids: "channel==MINE",
          startDate: from,
          endDate: to,
          dimensions: "video",
          metrics: metrics.join(","),
          sort: "-views",
          maxResults: limitSafe,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 20000,
      });
    };

    let analyticsRes;
    try {
      analyticsRes = await fetchAnalytics(true);
    } catch (err: any) {
      // Alguns relatórios não permitem likes/comments -> fallback
      if (axios.isAxiosError(err) && err.response?.status === 400) {
        analyticsRes = await fetchAnalytics(false);
      } else {
        throw err;
      }
    }

    const rows = (analyticsRes.data?.rows ?? []) as any[];
    if (!rows.length) return { items: [] };

    type RowParsed = {
      videoId: string;
      views: number;
      estimatedMinutesWatched: number;
      averageViewDuration: number;
      likes?: number;
      comments?: number;
    };

    const parsed: RowParsed[] = rows.map((r) => {
      const videoId = String(r[0]);
      const views = Number(r[1] ?? 0);
      const estimatedMinutesWatched = Number(r[2] ?? 0);
      const averageViewDuration = Number(r[3] ?? 0);

      const likes = r.length > 4 ? Number(r[4] ?? 0) : undefined;
      const comments = r.length > 5 ? Number(r[5] ?? 0) : undefined;

      return { videoId, views, estimatedMinutesWatched, averageViewDuration, likes, comments };
    });

    const ids = Array.from(new Set(parsed.map((p) => p.videoId).filter(Boolean)));

    // 2) Data API: detalhes (título/thumb/publishedAt)
    const detailsRes = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
      params: {
        part: "snippet",
        id: ids.join(","),
      },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 20000,
    });

    const metaById = new Map<
      string,
      { title?: string | null; thumb?: string | null; publishedAt?: string | null }
    >();

    for (const it of detailsRes.data?.items ?? []) {
      const id = String(it.id);
      const snippet = it.snippet ?? {};
      const thumbs = snippet.thumbnails ?? {};

      const thumb =
        thumbs.maxres?.url ||
        thumbs.standard?.url ||
        thumbs.high?.url ||
        thumbs.medium?.url ||
        thumbs.default?.url ||
        null;

      metaById.set(id, {
        title: snippet.title ?? null,
        thumb,
        publishedAt: snippet.publishedAt ?? null,
      });
    }

    // 3) Merge + engagementRate
    const items: YouTubeTopContentItem[] = parsed.map((p) => {
      const meta = metaById.get(p.videoId);

      const likes = p.likes ?? 0;
      const comments = p.comments ?? 0;
      const engagementRate = p.views > 0 ? (likes + comments) / p.views : 0;

      return {
        videoId: p.videoId,
        title: meta?.title ?? null,
        thumb: meta?.thumb ?? null,
        publishedAt: meta?.publishedAt ?? null,

        views: p.views,
        estimatedMinutesWatched: p.estimatedMinutesWatched,
        averageViewDuration: p.averageViewDuration,

        likes: p.likes,
        comments: p.comments,

        permalink: `https://www.youtube.com/watch?v=${p.videoId}`,
        engagementRate,
      };
    });

    return { items };
  }
}
