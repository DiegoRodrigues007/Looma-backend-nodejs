import axios from "axios";
import type {
  FetchDailyMetricsInput,
  IInstagramMetricsClient,
} from "../../../application/interfaces/instagram/IInstagramMetricsClient";

function s(v: any): string {
  return String(v ?? "").trim();
}

function safeNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isProviderDownAxiosError(err: any, msg: string): boolean {
  const code = s(err?.code).toUpperCase();
  const noResponse = !err?.response;

  const msgHit =
    /ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg) ||
    /socket hang up/i.test(msg) ||
    /Network Error/i.test(msg) ||
    /timeout/i.test(msg);

  const codeHit = [
    "ECONNREFUSED",
    "ECONNRESET",
    "ECONNABORTED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
  ].includes(code);

  if (noResponse && (err?.isAxiosError || codeHit || msgHit)) return true;
  return codeHit || msgHit;
}

function isReauthLikeError(status: any, msg: string, data: any): boolean {
  const st = Number(status);
  const metaType = s(data?.error?.type);
  const metaCode = s(data?.error?.code);
  const metaSubcode = s(data?.error?.error_subcode);

  const msgHit =
    /reauth|required/i.test(msg) ||
    /missing scopes/i.test(msg) ||
    /permissions?/i.test(msg) ||
    /access token/i.test(msg) ||
    /OAuth/i.test(msg) ||
    /Invalid OAuth/i.test(msg) ||
    /not authorized/i.test(msg);

  const metaHit =
    /OAuth/i.test(metaType) ||
    metaCode === "190" ||
    metaSubcode === "458" ||
    metaSubcode === "459";

  if (st === 401 || st === 403) return true;
  if (st === 400) return msgHit || metaHit;
  return false;
}

function classifyAndThrowAxiosError(err: any): never {
  const status = err?.response?.status;
  const data = err?.response?.data;

  const metaMsg = s(data?.error?.message);
  const axiosMsg = s(err?.message);
  const msg = metaMsg || axiosMsg || "Falha desconhecida ao chamar a Meta";

  if (isProviderDownAxiosError(err, msg)) {
    const code = s(err?.code);
    throw new Error(`provider down: ${msg || code || "network error"}`);
  }

  if (isReauthLikeError(status, msg, data)) {
    throw new Error(msg ? `reauth required: ${msg}` : "reauth required: permission error");
  }

  if (Number(status) >= 500) {
    throw new Error(`provider down: ${msg || "Meta 5xx"}`);
  }

  throw new Error(msg || "Falha ao chamar provider (Meta)");
}

type InsightsResponse = {
  data?: Array<{
    name?: string;
    values?: Array<{ value?: unknown }>;
    total_value?: { value?: unknown };
    value?: unknown;
  }>;
};

function pickMetricValue(body: InsightsResponse, metricName: string): number {
  const row = Array.isArray(body?.data)
    ? body.data.find((m) => String(m?.name ?? "") === metricName)
    : undefined;

  const v =
    row?.values?.[0]?.value ??
    row?.total_value?.value ??
    row?.value ??
    0;

  return safeNum(v);
}

export class AxiosInstagramMetricsClient implements IInstagramMetricsClient {
  private readonly graphBaseUrl: string;

  constructor(baseUrl?: string) {
    this.graphBaseUrl = (baseUrl ??
      process.env.INSTAGRAM_GRAPH_BASE_URL ??
      "https://graph.facebook.com/v21.0"
    ).replace(/\/+$/, "");
  }

  async getFollowersCount(input: FetchDailyMetricsInput): Promise<number> {
    const url = `${this.graphBaseUrl}/${encodeURIComponent(input.instagramAccountId)}`;

    try {
      const r = await axios.get(url, {
        params: {
          fields: "followers_count",
          access_token: input.accessToken,
        },
        timeout: input.timeoutMs ?? 15000,
      });

      return safeNum((r.data as any)?.followers_count);
    } catch (err: any) {
      classifyAndThrowAxiosError(err);
    }
  }

  async getDailyReach(input: FetchDailyMetricsInput): Promise<number> {
    const url = `${this.graphBaseUrl}/${encodeURIComponent(input.instagramAccountId)}/insights`;

    try {
      const r = await axios.get(url, {
        params: {
          metric: "reach",
          period: "day",
          access_token: input.accessToken,
        },
        timeout: input.timeoutMs ?? 15000,
      });

      return pickMetricValue(r.data as InsightsResponse, "reach");
    } catch (err: any) {
      classifyAndThrowAxiosError(err);
    }
  }

  async getDailyTotalInteractions(input: FetchDailyMetricsInput): Promise<number> {
    const url = `${this.graphBaseUrl}/${encodeURIComponent(input.instagramAccountId)}/insights`;

    try {
      const r = await axios.get(url, {
        params: {
          metric: "total_interactions",
          period: "day",
          metric_type: "total_value",
          access_token: input.accessToken,
        },
        timeout: input.timeoutMs ?? 15000,
      });

      return pickMetricValue(r.data as InsightsResponse, "total_interactions");
    } catch (err: any) {
      classifyAndThrowAxiosError(err);
    }
  }
}
