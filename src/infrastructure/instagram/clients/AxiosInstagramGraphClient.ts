import axios from "axios";
import type {
  IInstagramGraphClient,
  GetMediaReachInput,
  GetRecentMediaInput,
  GetRecentMediaOutput,
  IgMediaItem,
} from "../../../application/ports/instagram/IInstagramGraphClient";

function s(v: any): string {
  return String(v ?? "").trim();
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type IgMediaResponse = {
  data?: IgMediaItem[];
  paging?: {
    cursors?: { after?: string };
    next?: string;
  };
};

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

export class AxiosInstagramGraphClient implements IInstagramGraphClient {
  private readonly graphBaseUrl: string;

  constructor(baseUrl?: string) {
    this.graphBaseUrl = (baseUrl ??
      (process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0")
    ).replace(/\/+$/, "");
  }

  async getRecentMedia(input: GetRecentMediaInput): Promise<IgMediaItem[]> {
    const out = await this.getRecentMediaPaged(input);
    return out.data;
  }

  async getRecentMediaPaged(input: GetRecentMediaInput): Promise<GetRecentMediaOutput> {
    const { igUserId, accessToken, limit } = input;

    const fields =
      input.fields ??
      "id,caption,media_type,media_url,permalink,timestamp,thumbnail_url,like_count,comments_count";

    const url = `${this.graphBaseUrl}/${encodeURIComponent(igUserId)}/media`;

    try {
      const r = await axios.get(url, {
        params: {
          fields,
          limit,
          access_token: accessToken,
          ...(input.after ? { after: input.after } : {}),
        },
        timeout: input.timeoutMs ?? 15000,
      });

      const body = r.data as IgMediaResponse;

      return {
        data: Array.isArray(body?.data) ? body.data : [],
        paging: body?.paging,
      };
    } catch (err: any) {
      classifyAndThrowAxiosError(err);
    }
  }

  async getMediaReach(input: GetMediaReachInput): Promise<number> {
    const url = `${this.graphBaseUrl}/${encodeURIComponent(input.mediaId)}/insights`;

    try {
      const r = await axios.get(url, {
        params: {
          access_token: input.accessToken,
          metric: "reach",
        },
        timeout: input.timeoutMs ?? 15000,
      });

      const reachValue =
        (r.data as any)?.data?.[0]?.values?.[0]?.value ??
        (r.data as any)?.data?.[0]?.value ??
        0;

      return safeNum(reachValue);
    } catch (err: any) {
      classifyAndThrowAxiosError(err);
    }
  }
}
