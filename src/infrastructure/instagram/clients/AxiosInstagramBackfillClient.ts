import axios from "axios";
import { toFiniteNumber } from "../../../domain/metrics/instagram/instagramInsightsMapper";
import type { IInstagramBackfillClient, DailyInsights } from "../../../application/interfaces/instagram/IInstagramBackfillClient";

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function toUnixStartOfDayUTC(ymd: string) {
  return Math.floor(new Date(`${ymd}T00:00:00.000Z`).getTime() / 1000);
}
function toUnixEndOfDayUTC(ymd: string) {
  return Math.floor(new Date(`${ymd}T23:59:59.999Z`).getTime() / 1000);
}

type IgInsightsResponse = {
  data?: Array<{
    name?: string;
    values?: Array<{ value?: unknown; end_time?: string }>;
    total_value?: { value?: unknown };
    value?: unknown;
  }>;
};

function pickMetricValue(insights: IgInsightsResponse | null | undefined, metricName: string): number {
  const rows = Array.isArray(insights?.data) ? insights!.data! : [];
  const row = rows.find((r) => String(r?.name ?? "") === metricName);

  const v =
    row?.values?.[0]?.value ??
    row?.total_value?.value ??
    row?.value ??
    0;

  return toFiniteNumber(v);
}

export class AxiosInstagramBackfillClient implements IInstagramBackfillClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ??
      process.env.INSTAGRAM_GRAPH_BASE_URL ??
      "https://graph.facebook.com/v21.0"
    ).replace(/\/+$/, "");
  }

  async getDailyInsights(input: {
    igUserId: string;
    pageAccessToken: string;
    dayYmd: string;
    timeoutMs?: number;
  }): Promise<DailyInsights> {
    const igUserId = s(input.igUserId);
    const token = s(input.pageAccessToken);
    const day = s(input.dayYmd).slice(0, 10);

    const since = toUnixStartOfDayUTC(day);
    const until = toUnixEndOfDayUTC(day);

    const url = `${this.baseUrl}/${encodeURIComponent(igUserId)}/insights`;


    const r = await axios.get<IgInsightsResponse>(url, {
      params: {
        metric: "reach,profile_views,total_interactions",
        metric_type: "total_value",
        period: "day",
        since,
        until,
        access_token: token,
      },
      timeout: input.timeoutMs ?? 15000,
      validateStatus: () => true,
    });

    if (r.status < 200 || r.status >= 300) {
      const msg = String((r.data as any)?.error?.message ?? `HTTP_${r.status}`);
      throw new Error(`Graph /insights falhou (${day}): ${msg}`);
    }

    const reach = pickMetricValue(r.data, "reach");
    const profileViews = pickMetricValue(r.data, "profile_views");
    const totalInteractions = pickMetricValue(r.data, "total_interactions");

    return {
      reach: toFiniteNumber(reach),
      profileViews: toFiniteNumber(profileViews),
      totalInteractions: toFiniteNumber(totalInteractions),
    };
  }

  async getFollowersCountNow(input: {
    igUserId: string;
    pageAccessToken: string;
    timeoutMs?: number;
  }): Promise<number> {
    const igUserId = s(input.igUserId);
    const token = s(input.pageAccessToken);

    const url = `${this.baseUrl}/${encodeURIComponent(igUserId)}`;

    const r = await axios.get(url, {
      params: {
        fields: "followers_count",
        access_token: token,
      },
      timeout: input.timeoutMs ?? 15000,
      validateStatus: () => true,
    });

    if (r.status < 200 || r.status >= 300) return 0;

    return toFiniteNumber((r.data as any)?.followers_count);
  }
}
