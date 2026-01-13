// src/infrastructure/instagram/InstagramPostInsightsService.ts
import axios from "axios";
import type { AxiosResponse } from "axios";

export type IgMedia = {
  id: string;
  timestamp: string;
  media_type?: string;
  caption?: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
};

export type IgMediaWithInsights = IgMedia & {
  reach?: number;
  saves?: number;
  shares?: number;
};

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Instagram Graph entrega timestamps ISO com offset.
 * Para filtrar por janela de datas, o mais seguro é trabalhar com UTC range
 * baseado em YYYY-MM-DD (00:00:00Z .. 23:59:59.999Z).
 */
function toMsStartUtc(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`).getTime();
}
function toMsEndUtc(ymd: string) {
  return new Date(`${ymd}T23:59:59.999Z`).getTime();
}

/**
 * Pequeno sleep para aliviar rate-limit quando necessário
 */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as any;
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });

  await Promise.all(workers);
  return results;
}

type GraphPage<T> = {
  data?: T[];
  paging?: {
    next?: string;
    cursors?: { after?: string; before?: string };
  };
};

export class InstagramPostInsightsService {
  private readonly graphBaseUrl = "https://graph.facebook.com/v19.0";

  async fetchPostById(params: { accessToken: string; postId: string }): Promise<IgMediaWithInsights | null> {
    const { accessToken, postId } = params;

    const mediaRes: AxiosResponse<any> = await axios.get(`${this.graphBaseUrl}/${postId}`, {
      params: {
        access_token: accessToken,
        fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count",
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    if (mediaRes.status < 200 || mediaRes.status >= 300) return null;

    const m: any = mediaRes.data;
    if (!m?.id) return null;

    const insights = await this.fetchMediaInsights({
      accessToken,
      mediaId: String(m.id),
      mediaType: String(m.media_type ?? ""),
    });

    return {
      id: String(m.id),
      caption: m.caption ? String(m.caption) : undefined,
      media_type: m.media_type ? String(m.media_type) : undefined,
      permalink: m.permalink ? String(m.permalink) : undefined,
      timestamp: String(m.timestamp),
      like_count: safeNum(m.like_count),
      comments_count: safeNum(m.comments_count),
      ...insights,
    };
  }

  /**
   * ✅ Baseline robusto:
   * - pagina por cursor (paging.next)
   * - não corta antes do filtro por data
   * - para cedo quando percebe que já passou do "from" (itens vêm do mais novo pro mais antigo)
   * - concorrência baixa e com micro-sleep para reduzir rate-limit
   */
  async fetchBaselineMedia(params: {
    accessToken: string;
    igUserId: string;
    from: string; // YYYY-MM-DD
    to: string; // YYYY-MM-DD
    limit?: number; // quantidade final desejada (pós-filtro)
  }): Promise<IgMediaWithInsights[]> {
    const { accessToken, igUserId } = params;
    const limit = Math.min(Math.max(Number(params.limit ?? 60), 5), 150);

    const fromMs = toMsStartUtc(params.from);
    const toMs = toMsEndUtc(params.to);

    const fields = "id,caption,media_type,permalink,timestamp,like_count,comments_count";

    // o baseline deve tentar achar bem mais do que o "limit" final,
    // porque depois filtramos por data e removemos duplicados
    const maxItemsToScan = Math.max(350, limit * 6); // bem mais agressivo (resolve sampleSize=2)
    const maxPages = 20; // mais páginas, mas com early-stop por data

    const collected: IgMedia[] = [];
    const seen = new Set<string>();

    // usa params ao invés de montar query manual com encode (menos risco de bug)
    let nextUrl: string | null = `${this.graphBaseUrl}/${igUserId}/media`;
    let after: string | undefined;

    let page = 0;
    let shouldStopByDate = false;

    while (nextUrl && page < maxPages && collected.length < maxItemsToScan && !shouldStopByDate) {
      page++;

      const pageRes: AxiosResponse<GraphPage<IgMedia>> = await axios.get(nextUrl, {
        params: {
          access_token: accessToken,
          fields,
          limit: 50,
          ...(after ? { after } : {}),
        },
        timeout: 15000,
        validateStatus: () => true,
      });

      if (pageRes.status < 200 || pageRes.status >= 300) break;

      const rows = Array.isArray(pageRes.data?.data) ? pageRes.data.data : [];
      if (!rows.length) break;

      for (const m of rows) {
        const id = String((m as any)?.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        collected.push(m);

        // Early-stop:
        // API retorna do mais novo pro mais antigo.
        // Se já estamos coletando itens MUITO antigos (< fromMs), podemos parar.
        const tsMs = (m as any)?.timestamp ? new Date(String((m as any).timestamp)).getTime() : 0;
        if (tsMs && tsMs < fromMs) {
          // ainda deixa passar alguns itens para garantir, mas no geral já passou do range
          shouldStopByDate = true;
          break;
        }
        if (collected.length >= maxItemsToScan) break;
      }

      const next = pageRes.data?.paging?.next ? String(pageRes.data.paging.next) : null;
      const nextAfter = pageRes.data?.paging?.cursors?.after ? String(pageRes.data.paging.cursors.after) : undefined;

      // Preferimos cursor "after" para continuar no mesmo endpoint
      // Se não vier, caímos para paging.next completo (compat)
      if (nextAfter) {
        after = nextAfter;
        nextUrl = `${this.graphBaseUrl}/${igUserId}/media`;
      } else {
        nextUrl = next;
        after = undefined;
      }

      // micro-sleep pra aliviar rate-limit sem matar performance
      await sleep(150);
    }

    // 1) filtra por range de data (UTC day range)
    const inRange = collected.filter((m: any) => {
      const tsMs = m?.timestamp ? new Date(String(m.timestamp)).getTime() : 0;
      return tsMs >= fromMs && tsMs <= toMs;
    });

    // 2) ordena do mais recente para o mais antigo e pega "limit"
    const filtered = inRange
      .sort((a: any, b: any) => new Date(String(b.timestamp)).getTime() - new Date(String(a.timestamp)).getTime())
      .slice(0, limit);

    // 3) enriquece com insights (concorrência baixa)
    const enriched = await mapLimit(filtered, 2, async (m) => {
      // micro-sleep entre calls de insights por segurança
      await sleep(120);

      const insights = await this.fetchMediaInsights({
        accessToken,
        mediaId: String((m as any).id),
        mediaType: String((m as any).media_type ?? ""),
      });

      return {
        id: String((m as any).id),
        caption: (m as any).caption ? String((m as any).caption) : undefined,
        media_type: (m as any).media_type ? String((m as any).media_type) : undefined,
        permalink: (m as any).permalink ? String((m as any).permalink) : undefined,
        timestamp: String((m as any).timestamp),
        like_count: safeNum((m as any).like_count),
        comments_count: safeNum((m as any).comments_count),
        ...insights,
      };
    });

    return enriched;
  }

  /**
   * ✅ Insights com fallback por tipo e tolerância a permissão/metric-not-supported
   *
   * OBS:
   * - Alguns tipos de mídia não suportam "shares" ou "saved" via insights dependendo de permissões/conta.
   * - Em erros, retornamos 0 (como você já fazia), mas agora tentamos um fallback de métricas alternativas.
   */
  private async fetchMediaInsights(params: {
    accessToken: string;
    mediaId: string;
    mediaType?: string;
  }): Promise<{ reach?: number; saves?: number; shares?: number }> {
    const { accessToken, mediaId } = params;

    let reach = 0;
    let saves = 0;
    let shares = 0;

    // tenta o pacote principal primeiro
    const tryMetrics = async (metric: string) => {
      const insightsRes: AxiosResponse<any> = await axios.get(`${this.graphBaseUrl}/${mediaId}/insights`, {
        params: { access_token: accessToken, metric },
        timeout: 15000,
        validateStatus: () => true,
      });

      if (insightsRes.status < 200 || insightsRes.status >= 300) {
        throw new Error(`HTTP_${insightsRes.status}`);
      }

      const data: any[] = Array.isArray(insightsRes.data?.data) ? insightsRes.data.data : [];

      const getMetric = (name: string) => {
        const row = data.find((x: any) => x?.name === name);
        const v = row?.values?.[0]?.value ?? row?.value ?? 0;
        return safeNum(v);
      };

      return {
        reach: getMetric("reach"),
        saved: getMetric("saved"),
        shares: getMetric("shares"),
      };
    };

    try {
      const r1 = await tryMetrics("reach,saved,shares");
      reach = safeNum(r1.reach);
      saves = safeNum(r1.saved);
      shares = safeNum(r1.shares);
    } catch {
      // fallback: tenta pelo menos reach (geralmente existe)
      try {
        const r2 = await tryMetrics("reach");
        reach = safeNum(r2.reach);
      } catch {
        // ignore
      }
      // fallback: tenta saved sozinho (às vezes o bundle falha)
      try {
        const r3 = await tryMetrics("saved");
        saves = safeNum(r3.saved);
      } catch {
        // ignore
      }
      // fallback: tenta shares sozinho
      try {
        const r4 = await tryMetrics("shares");
        shares = safeNum(r4.shares);
      } catch {
        // ignore
      }
    }

    return {
      reach: reach || 0,
      saves: saves || 0,
      shares: shares || 0,
    };
  }
}
