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

function ymdFromAny(v: unknown): string {
  const str = s(v);
  if (!str) return "";
  // aceita "YYYY-MM-DD" ou ISO
  return str.length >= 10 ? str.slice(0, 10) : "";
}

function toUnixSecondsUtc(ymd: string): number {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00.000Z`);
  return Math.floor(d.getTime() / 1000);
}

function ymdTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function ymdAddDaysUtc(ymd: string, days: number): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isProviderDownAxiosError(err: any, msg: string): boolean {
  const code = s(err?.code).toUpperCase();
  const noResponse = !err?.response;

  const msgHit =
    /ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(
      msg
    ) ||
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
    throw new Error(
      msg ? `reauth required: ${msg}` : "reauth required: permission error"
    );
  }

  if (Number(status) >= 500) {
    throw new Error(`provider down: ${msg || "Meta 5xx"}`);
  }

  throw new Error(msg || "Falha ao chamar provider (Meta)");
}

type InsightsValueRow = {
  value?: unknown;
  end_time?: string; // ISO
};

type InsightsMetricRow = {
  name?: string;
  values?: InsightsValueRow[];
  total_value?: { value?: unknown };
  value?: unknown;
};

type InsightsResponse = {
  data?: InsightsMetricRow[];
};

function pickMetricRow(body: InsightsResponse, metricName: string) {
  const row = Array.isArray(body?.data)
    ? body.data.find((m) => String(m?.name ?? "") === metricName)
    : undefined;
  return row;
}

function pickMetricValue(body: InsightsResponse, metricName: string): number {
  const row = pickMetricRow(body, metricName);

  const v =
    row?.values?.[0]?.value ?? row?.total_value?.value ?? row?.value ?? 0;

  return safeNum(v);
}

/**
 * Extrai série diária:
 * - cada item usa o end_time (ou cai pra "YYYY-MM-DD" do today se não existir)
 * - value pode ser number OU objeto (ex: {follows, unfollows})
 */
function pickMetricSeries(body: InsightsResponse, metricName: string): Array<{
  date: string;
  value: unknown;
}> {
  const row = pickMetricRow(body, metricName);
  const values = Array.isArray(row?.values) ? row!.values! : [];
  return values.map((v) => ({
    date: ymdFromAny(v?.end_time) || ymdTodayUtc(),
    value: v?.value,
  }));
}

export class AxiosInstagramMetricsClient implements IInstagramMetricsClient {
  private readonly graphBaseUrl: string;

  constructor(baseUrl?: string) {
    this.graphBaseUrl = (baseUrl ??
      process.env.INSTAGRAM_GRAPH_BASE_URL ??
      "https://graph.facebook.com/v21.0"
    ).replace(/\/+$/, "");
  }

  // ======================================================
  // ✅ MÉTODOS EXIGIDOS PELA INTERFACE (mantidos)
  // ======================================================

  async getFollowersCount(input: FetchDailyMetricsInput): Promise<number> {
    const url = `${this.graphBaseUrl}/${encodeURIComponent(
      input.instagramAccountId
    )}`;

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
    const url = `${this.graphBaseUrl}/${encodeURIComponent(
      input.instagramAccountId
    )}/insights`;

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
    const url = `${this.graphBaseUrl}/${encodeURIComponent(
      input.instagramAccountId
    )}/insights`;

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

  // ======================================================
  // ✅ NOVOS MÉTODOS (para backfill “correto” até 30 dias)
  // ======================================================

  /**
   * Tenta buscar a série diária de follower_count (quando a Meta disponibiliza).
   * - Limitação: normalmente só últimos 30 dias.
   * - Retorno: [{date, followers}]
   */
  async getFollowerCountSeriesLast30Days(input: FetchDailyMetricsInput): Promise<
    Array<{ date: string; followers: number }>
  > {
    const url = `${this.graphBaseUrl}/${encodeURIComponent(
      input.instagramAccountId
    )}/insights`;

    // janela: últimos 30 dias (UTC)
    const untilYmd = ymdTodayUtc();
    const sinceYmd = ymdAddDaysUtc(untilYmd, -29);

    try {
      const r = await axios.get(url, {
        params: {
          metric: "follower_count",
          period: "day",
          since: toUnixSecondsUtc(sinceYmd),
          until: toUnixSecondsUtc(ymdAddDaysUtc(untilYmd, 1)), // inclui o dia "until"
          access_token: input.accessToken,
        },
        timeout: input.timeoutMs ?? 15000,
      });

      const series = pickMetricSeries(r.data as InsightsResponse, "follower_count");
      const out = series
        .map((p) => ({
          date: p.date,
          followers: safeNum(p.value),
        }))
        .filter((x) => !!x.date);

      // ordena por data
      out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      return out;
    } catch (err: any) {
      classifyAndThrowAxiosError(err);
    }
  }

  /**
   * Tenta buscar "follows_and_unfollows" diário (quando disponível/permissão ok).
   * Retorno: [{date, follows, unfollows}]
   *
   * OBS: A Meta pode retornar "gaps" (dias faltando). Isso é esperado.
   */
  async getFollowsAndUnfollowsLast30Days(input: FetchDailyMetricsInput): Promise<
    Array<{ date: string; follows: number; unfollows: number }>
  > {
    const url = `${this.graphBaseUrl}/${encodeURIComponent(
      input.instagramAccountId
    )}/insights`;

    const untilYmd = ymdTodayUtc();
    const sinceYmd = ymdAddDaysUtc(untilYmd, -29);

    try {
      const r = await axios.get(url, {
        params: {
          metric: "follows_and_unfollows",
          period: "day",
          since: toUnixSecondsUtc(sinceYmd),
          until: toUnixSecondsUtc(ymdAddDaysUtc(untilYmd, 1)),
          access_token: input.accessToken,
        },
        timeout: input.timeoutMs ?? 15000,
      });

      const series = pickMetricSeries(
        r.data as InsightsResponse,
        "follows_and_unfollows"
      );

      const out = series
        .map((p) => {
          const v = p.value as any;

          // a Meta pode retornar number, object, etc — aqui a gente trata com segurança
          const follows = safeNum(v?.follows ?? v?.follow ?? v?.in ?? v ?? 0);
          const unfollows = safeNum(
            v?.unfollows ?? v?.unfollow ?? v?.out ?? 0
          );

          return { date: p.date, follows, unfollows };
        })
        .filter((x) => !!x.date);

      out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      return out;
    } catch (err: any) {
      classifyAndThrowAxiosError(err);
    }
  }
}
