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

type GraphError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

function extractGraphError(data: any): GraphError | null {
  const err = data?.error;
  if (!err) return null;
  return {
    message: err?.message,
    type: err?.type,
    code: err?.code,
    error_subcode: err?.error_subcode,
    fbtrace_id: err?.fbtrace_id,
  };
}

function formatGraphError(prefix: string, err: GraphError | null): string {
  if (!err) return prefix;
  const code = err.code != null ? ` (#${err.code})` : "";
  const msg = err.message ? ` ${err.message}` : "";
  return `${prefix}${code}${msg}`.trim();
}

function parseInsightsRows(data: any): any[] {
  return Array.isArray(data?.data) ? data.data : [];
}

function getMetricValueFromRows(rows: any[], name: string): number {
  const m = rows.find((x) => x?.name === name);
  const v0 = Array.isArray(m?.values) ? m.values[0]?.value : undefined;
  return safeInt(v0);
}

export class AxiosInstagramDailyMetricsClient implements IInstagramDailyMetricsClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (
      baseUrl ??
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

    const err = extractGraphError(data);
    if (err) {
      // Se der erro, preferimos não quebrar tudo aqui — mas você pode trocar por throw se quiser hard-fail
      return 0;
    }

    return safeInt((data as any)?.followers_count);
  }

  async getInsightsForDay(input: FetchInsightsDayInput): Promise<DailyInsights> {
    const url = `${this.baseUrl}/${encodeURIComponent(input.igUserId)}/insights`;

    const since = toUnixStartOfDayUTC(input.dayYmd);
    const until = toUnixEndOfDayUTC(input.dayYmd);

    // 1) métricas "normais" (sem metric_type)
    const { data: dataMain } = await axios.get(url, {
      params: {
        metric: "reach,accounts_engaged",
        period: "day",
        since,
        until,
        access_token: input.accessToken,
      },
      timeout: input.timeoutMs ?? 20000,
      validateStatus: () => true,
    });

    const errMain = extractGraphError(dataMain);
    if (errMain) {
      // Aqui eu "hard-fail" porque se reach/accounts_engaged falhar,
      // seu job provavelmente não deve gravar dados incompletos.
      throw new Error(formatGraphError("[IG][INSIGHTS:main]", errMain));
    }

    const rowsMain = parseInsightsRows(dataMain);

    // 2) profile_views exige metric_type=total_value
    let profileViews = 0;
    try {
      const { data: dataProfileViews } = await axios.get(url, {
        params: {
          metric: "profile_views",
          period: "day",
          metric_type: "total_value",
          since,
          until,
          access_token: input.accessToken,
        },
        timeout: input.timeoutMs ?? 20000,
        validateStatus: () => true,
      });

      const errPv = extractGraphError(dataProfileViews);
      if (errPv) {
        profileViews = 0;
      } else {
        const rowsPv = parseInsightsRows(dataProfileViews);
        profileViews = getMetricValueFromRows(rowsPv, "profile_views");
      }
    } catch {
      profileViews = 0;
    }

    return {
      reach: getMetricValueFromRows(rowsMain, "reach"),
      profileViews,
      accountsEngaged: getMetricValueFromRows(rowsMain, "accounts_engaged"),
    };
  }
}
