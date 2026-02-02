import axios from "axios";
import type {
  IInstagramDailyMetricsClient,
  DailyInsights,
  FetchFollowersInput,
  FetchInsightsDayInput,
} from "../../../application/interfaces/instagram/IInstagramDailyMetricsClient";

function safeInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toUnixStartOfDayUTC(ymd: string) {
  return Math.floor(new Date(`${ymd}T00:00:00.000Z`).getTime() / 1000);
}
function toUnixEndOfDayUTC(ymd: string) {
  return Math.floor(new Date(`${ymd}T23:59:59.999Z`).getTime() / 1000);
}

export class AxiosInstagramDailyMetricsClient implements IInstagramDailyMetricsClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ??
      process.env.INSTAGRAM_GRAPH_BASE_URL ?? 
      "https://graph.facebook.com/v21.0"
    ).replace(/\/+$/, "");
  }

  async getFollowersCount(input: FetchFollowersInput): Promise<number> {
    const url = `${this.baseUrl}/${encodeURIComponent(input.igUserId)}`;

    const { data } = await axios.get(url, {
      params: {
        fields: "followers_count",
        access_token: input.accessToken,
      },
      timeout: input.timeoutMs ?? 15000,
      validateStatus: () => true,
    });

    return safeInt((data as any)?.followers_count);
  }

  async getInsightsForDay(input: FetchInsightsDayInput): Promise<DailyInsights> {
    const url = `${this.baseUrl}/${encodeURIComponent(input.igUserId)}/insights`;

    const since = toUnixStartOfDayUTC(input.dayYmd);
    const until = toUnixEndOfDayUTC(input.dayYmd);

    const { data } = await axios.get(url, {
      params: {
        metric: "reach,profile_views,accounts_engaged",
        period: "day",
        since,
        until,
        access_token: input.accessToken,
      },
      timeout: input.timeoutMs ?? 20000,
      validateStatus: () => true,
    });

    const rows: any[] = Array.isArray((data as any)?.data) ? (data as any).data : [];

    const getMetricValue = (name: string) => {
      const m = rows.find((x) => x?.name === name);
      const v0 = Array.isArray(m?.values) ? m.values[0]?.value : undefined;
      return safeInt(v0);
    };

    return {
      reach: getMetricValue("reach"),
      profileViews: getMetricValue("profile_views"),
      accountsEngaged: getMetricValue("accounts_engaged"),
    };
  }
}
