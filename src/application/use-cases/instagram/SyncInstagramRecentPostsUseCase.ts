// src/application/use-cases/instagram/SyncInstagramRecentPostsUseCase.ts
import axios from "axios";
import { prisma } from "../../../infrastructure/db/prismaClient";

function s(v: any): string {
  return String(v ?? "").trim();
}

function splitScopes(v: any): string[] {
  return s(v)
    .split(/[,\s]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Meta costuma retornar timestamp assim: "2026-01-24T00:00:00+0000"
 * Em alguns ambientes, o Date() não parseia "+0000" (sem ":"), então normalizamos.
 */
function parseMetaTimestampToDate(ts: any): Date | null {
  const raw = s(ts);
  if (!raw) return null;

  // Converte +0000 / -0300 -> +00:00 / -03:00
  const normalized = raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

type IgMediaItem = {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  thumbnail_url?: string;
};

type IgMediaResponse = {
  data?: IgMediaItem[];
};

export type SyncRecentPostsParams = {
  userId: string;
  instagramAccountId?: string | null;
  limit?: number; // default 20
  deleteOldBeyondLimit?: boolean; // default true
};

export type SyncRecentPostsResult = {
  ok: true;
  instagramAccountIdUsed: string;
  fetched: number;
  upserted: number;
  deletedOld: number;
};

function isProviderDownAxiosError(err: any, msg: string): boolean {
  const code = s(err?.code).toUpperCase();
  const noResponse = !err?.response; // axios falhou antes de receber HTTP

  // padrões bem comuns em testes quando o fake server não está acessível
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

  // Se não tem response (não houve HTTP) e é erro do axios, quase sempre é rede/provider
  if (noResponse && (err?.isAxiosError || codeHit || msgHit)) return true;

  return codeHit || msgHit;
}

function isReauthLikeError(status: any, msg: string, data: any): boolean {
  const st = Number(status);

  // sinais típicos de auth/permissão da Meta
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
    metaCode === "190" || // token inválido/expirado geralmente cai aqui
    metaSubcode === "458" ||
    metaSubcode === "459";

  // 401/403 quase sempre auth; 400 depende — só marca se tiver evidência
  if (st === 401 || st === 403) return true;
  if (st === 400) return msgHit || metaHit;

  return false;
}

export class SyncInstagramRecentPostsUseCase {
  // ✅ respeita .env / .env.test
  // Ex.: em testes => http://127.0.0.1:4111/v21.0
  private readonly graphBaseUrl = (
    process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0"
  ).replace(/\/+$/, "");

  async execute(params: SyncRecentPostsParams): Promise<SyncRecentPostsResult> {
    const userId = s(params.userId);
    if (!userId) throw new Error("userId é obrigatório");

    const limit = Math.max(1, Math.min(50, Number(params.limit ?? 20) || 20));
    const deleteOldBeyondLimit = params.deleteOldBeyondLimit ?? true;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeInstagramAccountId: true },
    });

    const desiredAccountId =
      s(params.instagramAccountId ?? "") ||
      s(user?.activeInstagramAccountId ?? "");

    const account =
      (desiredAccountId
        ? await prisma.instagramAccount.findFirst({
            where: { id: desiredAccountId, userId, isConnected: true },
            orderBy: { updatedAt: "desc" },
          })
        : null) ||
      (await prisma.instagramAccount.findFirst({
        where: { userId, isConnected: true },
        orderBy: { updatedAt: "desc" },
      }));

    if (!account) {
      throw new Error("Conta do Instagram não encontrada");
    }

    const instagramAccountIdUsed = account.id;

    const igUserId = s((account as any)?.igUserId);

    // 🔑 AJUSTE IMPORTANTE:
    // Em produção usamos pageAccessToken
    // Em testes (ou contas antigas), usamos accessToken como fallback
    const pageAccessToken =
      s((account as any)?.pageAccessToken) || s((account as any)?.accessToken);

    if (!igUserId || !pageAccessToken) {
      throw new Error("Conta IG sem igUserId/token válido. Refaça a conexão.");
    }

    // ✅ AJUSTE (para passar seu teste de permissions):
    // Se existir grantedScopes no DB, valida se tem os mínimos necessários.
    // - Se não existir grantedScopes (contas antigas/testes), NÃO bloqueia.
    const grantedRaw = (account as any)?.grantedScopes;
    const granted = splitScopes(grantedRaw);

    if (grantedRaw != null && granted.length > 0) {
      const required = [
        "instagram_basic",
        "instagram_manage_insights",
        "pages_show_list",
        "pages_read_engagement",
        "pages_read_user_content",
      ];

      const missing = required.filter((r) => !granted.includes(r));
      if (missing.length > 0) {
        throw new Error(
          `reauth required: missing scopes: ${missing.join(", ")}`
        );
      }
    }

    // ✅ Graph API: últimos posts
    const fields =
      "id,caption,media_type,media_url,permalink,timestamp,thumbnail_url";

    // ✅ base configurável (fake server em testes)
    // /{igUserId}/media
    const url = `${this.graphBaseUrl}/${encodeURIComponent(igUserId)}/media`;

    let items: IgMediaItem[] = [];

    try {
      const r = await axios.get(url, {
        params: {
          fields,
          limit,
          access_token: pageAccessToken,
        },
        timeout: 15000,
      });

      const body = r.data as IgMediaResponse;
      items = Array.isArray(body?.data) ? body.data : [];
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;

      // tenta extrair mensagem “real” do axios/meta
      const metaMsg = s(data?.error?.message);
      const axiosMsg = s(err?.message);
      const msg = metaMsg || axiosMsg || "Falha desconhecida ao chamar a Meta";

      // ✅ provider fora do ar / rede (pra rota mapear 502)
      if (isProviderDownAxiosError(err, msg)) {
        const code = s(err?.code);
        throw new Error(`provider down: ${msg || code || "network error"}`);
      }

      // ✅ permissão/auth => reauth
      if (isReauthLikeError(status, msg, data)) {
        throw new Error(
          msg ? `reauth required: ${msg}` : "reauth required: permission error"
        );
      }

      // outros erros HTTP do provider (ex.: 5xx) — continua sendo provider, mas não é “rede”
      // Se você quiser mapear isso pra 502 também (normalmente sim), use "provider down:" aqui também.
      if (Number(status) >= 500) {
        throw new Error(`provider down: ${msg || "Meta 5xx"}`);
      }

      throw new Error(msg || "Falha ao buscar posts no provider (Meta)");
    }

    if (items.length === 0) {
      return {
        ok: true,
        instagramAccountIdUsed,
        fetched: 0,
        upserted: 0,
        deletedOld: 0,
      };
    }

    let upserted = 0;

    for (const it of items) {
      const igMediaId = s(it.id);
      if (!igMediaId) continue;

      const publishedAt = parseMetaTimestampToDate(it.timestamp) ?? new Date();

      const thumb = s(it.thumbnail_url) || s(it.media_url) || null;

      await prisma.instagramPost.upsert({
        where: {
          instagramAccountId_igMediaId: {
            instagramAccountId: instagramAccountIdUsed,
            igMediaId,
          },
        },
        create: {
          userId,
          instagramAccountId: instagramAccountIdUsed,
          igMediaId,
          mediaType: it.media_type ?? null,
          publishedAt,
          caption: it.caption ?? null,
          permalink: it.permalink ?? null,
          likeCount: 0,
          commentsCount: 0,
          thumb,
        },
        update: {
          mediaType: it.media_type ?? null,
          publishedAt,
          caption: it.caption ?? null,
          permalink: it.permalink ?? null,
          thumb,
        },
      });

      upserted++;
    }

    let deletedOld = 0;
    if (deleteOldBeyondLimit) {
      const keep = items.map((x) => s(x.id)).filter(Boolean);

      const del = await prisma.instagramPost.deleteMany({
        where: {
          userId,
          instagramAccountId: instagramAccountIdUsed,
          igMediaId: { notIn: keep },
        },
      });

      deletedOld = del.count ?? 0;
    }

    return {
      ok: true,
      instagramAccountIdUsed,
      fetched: items.length,
      upserted,
      deletedOld,
    };
  }
}