import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import type { IYouTubeAuthService, YouTubeChannelInfo, YouTubeTokenPayload } from "../../application/youtube/IYouTubeAuthService";

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

  private scopes = (process.env.YOUTUBE_SCOPES ??
    "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly")
    .split(" ")
    .map(s => s.trim())
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
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope ?? null,
    };
  }

  async refreshAccessToken(refreshToken: string) {
    const client = new OAuth2Client({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      redirectUri: this.redirectUri,
    });

    client.setCredentials({ refresh_token: refreshToken });

    const res = await client.getAccessToken();
    const accessToken = res.token;
    if (!accessToken) throw new Error("Falha ao renovar access token do Google");

    // google-auth-library não dá expiry sempre; quando não vier, você controla pelo store/tempo
    return { accessToken, expiresAt: null };
  }

  async getMyChannel(accessToken: string): Promise<YouTubeChannelInfo> {
    const res = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
      params: { part: "snippet,statistics", mine: "true" },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    });

    const item = res.data?.items?.[0];
    if (!item?.id) throw new Error("Não foi possível identificar o channelId (channels.list mine=true vazio)");

    const snippet = item.snippet ?? {};
    const stats = item.statistics ?? {};

    return {
      channelId: String(item.id),
      title: snippet.title ?? null,
      handle: snippet.customUrl ?? null, // "customUrl" costuma ser o handle/vanity
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
      rows: rows.map(r => ({
        day: String(r[0]),
        views: Number(r[1] ?? 0),
        estimatedMinutesWatched: Number(r[2] ?? 0),
        averageViewDuration: Number(r[3] ?? 0),
        subscribersGained: Number(r[4] ?? 0),
        subscribersLost: Number(r[5] ?? 0),
      })),
    };
  }
}
