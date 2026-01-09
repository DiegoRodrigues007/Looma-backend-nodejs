import axios from "axios";

export type TopContentItem = {
  id: string;
  permalink?: string;
  mediaType?: string;
  captionLength?: number;

  reach?: number;
  totalInteractions: number; // likes + comments
};

type FetchTopContentParams = {
  accessToken: string;
  igUserId: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  limit?: number;
};

function toMsStart(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`).getTime();
}

function toMsEnd(ymd: string) {
  return new Date(`${ymd}T23:59:59.999Z`).getTime();
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ✅ limita concorrência para evitar rate-limit do Graph
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length) as any;
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

export class InstagramTopContentService {
  private readonly graphBaseUrl = "https://graph.facebook.com/v19.0";

  async fetchTopContent({
    accessToken,
    igUserId,
    from,
    to,
    limit = 10,
  }: FetchTopContentParams): Promise<TopContentItem[]> {
    if (!accessToken) throw new Error("accessToken is required");
    if (!igUserId) throw new Error("igUserId is required");
    if (!from || !to) throw new Error("from/to are required");

    const fromMs = toMsStart(from);
    const toMs = toMsEnd(to);

    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      throw new Error("Invalid date range (from/to)");
    }

    // ✅ 1) Lista mídias com likes/comments já incluídos (evita request extra por item)
    const mediaResp = await axios.get(`${this.graphBaseUrl}/${igUserId}/media`, {
      params: {
        access_token: accessToken,
        fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count",
        limit: 50,
      },
      timeout: 15000,
    });

    const items = Array.isArray(mediaResp.data?.data) ? mediaResp.data.data : [];

    // ✅ Filtra pelo período
    const inRange = items
      .filter((m: any) => {
        const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
        return ts >= fromMs && ts <= toMs;
      })
      .slice(0, Math.max(limit * 3, 25)); // pega uma amostra maior para ordenar

    // ✅ Base (interações e metadados)
    const base: TopContentItem[] = inRange.map((m: any) => {
      const caption = String(m.caption ?? "");
      const likeCount = safeNum(m.like_count);
      const commentsCount = safeNum(m.comments_count);

      return {
        id: String(m.id),
        permalink: m.permalink ? String(m.permalink) : undefined,
        mediaType: m.media_type ? String(m.media_type) : undefined,
        captionLength: caption.length,
        totalInteractions: likeCount + commentsCount,
        reach: 0, // preenchido depois (se possível)
      };
    });

    // ✅ Ordena por interações e corta para um conjunto pequeno (pra buscar reach só do necessário)
    base.sort((a, b) => (b.totalInteractions ?? 0) - (a.totalInteractions ?? 0));
    const topCandidates = base.slice(0, Math.max(limit, 10));

    // ✅ 2) Busca reach via insights (paralelo limitado)
    // Observação: pode falhar por permissão — não quebra o fluxo.
    const enriched = await mapLimit(topCandidates, 4, async (item) => {
      let reach = 0;

      try {
        const insightsResp = await axios.get(
          `${this.graphBaseUrl}/${item.id}/insights`,
          {
            params: {
              access_token: accessToken,
              metric: "reach",
            },
            timeout: 15000,
          }
        );

        const reachValue =
          insightsResp.data?.data?.[0]?.values?.[0]?.value ??
          insightsResp.data?.data?.[0]?.value ??
          0;

        reach = safeNum(reachValue);
      } catch {
        reach = 0;
      }

      return { ...item, reach };
    });

    // ✅ retorna top N final
    enriched.sort((a, b) => (b.totalInteractions ?? 0) - (a.totalInteractions ?? 0));
    return enriched.slice(0, limit);
  }
}
