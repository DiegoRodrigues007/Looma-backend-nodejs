import type { IInstagramGraphClient } from "../../../application/interfaces/instagram/IInstagramGraphClient";
import {
  DateRangeYmd,
  Ymd,
  DataIntegrityGuard,
  DailyInteractionsCalculator,
  InstagramDomainError,
  ConcurrencyPolicy,
} from "../../../domain/instagram";

export type FetchDailyInteractionsByPostsInput = {
  igUserId: string;
  accessToken: string;
  from: string;
  to: string;
  maxPosts?: number;
  pageLimit?: number;
};

export type DailyInteractions = ReturnType<
  typeof DailyInteractionsCalculator.compute
>[number];

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length) as any;
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const current = nextIndex++;
        results[current] = await fn(items[current], current);
      }
    }
  );

  await Promise.all(workers);
  return results;
}

/**
 * ✅ Aceita Date | ISO string e devolve YYYY-MM-DD (UTC)
 */
function safeTimestampToYmd(ts: unknown): string | null {
  if (!ts) return null;

  // Date
  if (ts instanceof Date) {
    const iso = ts.toISOString();
    const ymd = iso.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
  }

  // string / number etc
  const s = String(ts ?? "").trim();
  if (!s) return null;

  // se vier ISO string, corta
  const ymd = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

function daysInclusive(fromYmd: string, toYmd: string): number {
  const a = new Date(`${fromYmd}T00:00:00.000Z`).getTime();
  const b = new Date(`${toYmd}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  if (a > b) return 1;
  return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

function ymdToString(ymd: any): string | null {
  if (!ymd) return null;

  if (typeof ymd === "string") {
    const s = ymd.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }

  const maybe =
    (typeof ymd?.toString === "function" ? String(ymd.toString()) : "") ||
    String((ymd as any)?.value ?? "") ||
    String((ymd as any)?._value ?? "") ||
    "";

  const s = maybe.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function safeInt(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * Busca SAVED e SHARES por media.
 * - Usa métodos do graph client se existirem.
 * - Não quebra se o client ainda não implementou isso (retorna 0).
 */
async function enrichMediaWithSavedShares(
  graph: IInstagramGraphClient,
  mediaIds: string[],
  accessToken: string
): Promise<Record<string, { saved: number; shares: number }>> {
  const conc = ConcurrencyPolicy.limitFor("insights_per_media");

  const pairs = await mapLimit(mediaIds, conc, async (id) => {
    try {
      const g: any = graph as any;

      // ✅ Opção A: método genérico de insights
      if (typeof g.getMediaInsights === "function") {
        const resp = await g.getMediaInsights({
          mediaId: id,
          accessToken,
          metrics: ["saved", "shares"],
          timeoutMs: 15000,
        });

        // 1) { saved, shares } ou { data: { saved, shares } }
        const directSaved = resp?.saved ?? resp?.data?.saved;
        const directShares = resp?.shares ?? resp?.data?.shares;

        if (directSaved != null || directShares != null) {
          const saved = DataIntegrityGuard.nonNegativeInt(
            "saved",
            directSaved ?? 0
          ).value;
          const shares = DataIntegrityGuard.nonNegativeInt(
            "shares",
            directShares ?? 0
          ).value;
          return [id, { saved, shares }] as const;
        }

        // 2) { data: [{name:"saved", ...}, {name:"shares", ...}] }
        const arr = Array.isArray(resp?.data) ? resp.data : [];
        const byName = new Map<string, number>();

        for (const it of arr) {
          const name = String(it?.name ?? "").toLowerCase();
          const v =
            it?.total_value?.value ??
            it?.value ??
            (Array.isArray(it?.values) ? it?.values?.[0]?.value : undefined) ??
            0;

          byName.set(
            name,
            DataIntegrityGuard.nonNegativeInt(name, v).value
          );
        }

        const saved = byName.get("saved") ?? 0;
        const shares = byName.get("shares") ?? 0;

        return [id, { saved, shares }] as const;
      }

      // ✅ Opção B: método específico
      if (typeof g.getMediaSavedShares === "function") {
        const resp = await g.getMediaSavedShares({
          mediaId: id,
          accessToken,
          timeoutMs: 15000,
        });

        const saved = DataIntegrityGuard.nonNegativeInt(
          "saved",
          resp?.saved ?? 0
        ).value;
        const shares = DataIntegrityGuard.nonNegativeInt(
          "shares",
          resp?.shares ?? 0
        ).value;

        return [id, { saved, shares }] as const;
      }

      return [id, { saved: 0, shares: 0 }] as const;
    } catch {
      return [id, { saved: 0, shares: 0 }] as const;
    }
  });

  return Object.fromEntries(pairs);
}

export async function fetchDailyInteractionsByPosts(
  graph: IInstagramGraphClient,
  input: FetchDailyInteractionsByPostsInput
): Promise<
  Array<
    DailyInteractions & {
      ymd: string;
      totalInteractions: number;
      likes: number;
      comments: number;
      shares: number;
      saved: number;
    }
  >
> {
  const igUserId = String(input.igUserId ?? "").trim();
  const accessToken = String(input.accessToken ?? "").trim();

  if (!igUserId) throw InstagramDomainError.invalidInput("igUserId is required");
  if (!accessToken) {
    throw new InstagramDomainError({
      code: "INVALID_TOKEN",
      message: "accessToken is required",
      retryable: false,
    });
  }

  const range = DateRangeYmd(input.from, input.to);

  const pageLimit = Math.max(
    1,
    Math.min(50, Math.floor(input.pageLimit ?? 50))
  );

  const days = daysInclusive(range.from, range.to);
  const maxPosts = Math.max(
    30,
    Math.min(500, Math.floor(input.maxPosts ?? days * 15))
  );

  // ✅ fields RAW (o client pode ignorar/normalizar)
  const fields = "id,timestamp,like_count,comments_count";

  const media: any[] = [];
  let after: string | undefined = undefined;

  const maxPages = Math.min(20, Math.max(1, Math.ceil(maxPosts / pageLimit)));

  for (let page = 0; page < maxPages && media.length < maxPosts; page++) {
    const remaining = maxPosts - media.length;
    const pageSize = Math.min(pageLimit, remaining);

    try {
      const resp = await graph.getRecentMediaPaged({
        igUserId,
        accessToken,
        limit: pageSize,
        after,
        fields,
        timeoutMs: 15000,
      });

      const batch = Array.isArray(resp.data) ? resp.data : [];
      if (!batch.length) break;

      media.push(...batch);

      const nextAfter = resp.paging?.cursors?.after;
      if (!nextAfter) break;
      after = nextAfter;
    } catch {
      break;
    }
  }

  // ✅ ids dentro do range
  const mediaInRange = media
    .map((m) => {
      // ✅ timestamp pode ser Date (normalizado pelo client)
      const ymdStr = safeTimestampToYmd(m?.timestamp);
      if (!ymdStr) return null;

      let ymd: ReturnType<typeof Ymd>;
      try {
        ymd = Ymd(ymdStr);
      } catch {
        return null;
      }

      if (ymd < range.from || ymd > range.to) return null;

      return { id: String(m?.id ?? ""), ymdStr, ymd, raw: m };
    })
    .filter(Boolean) as Array<{
    id: string;
    ymdStr: string;
    ymd: ReturnType<typeof Ymd>;
    raw: any;
  }>;

  const ids = mediaInRange.map((x) => x.id).filter(Boolean);

  // ✅ saved/shares por media (se existir no client)
  const savedSharesByMedia = await enrichMediaWithSavedShares(
    graph,
    ids,
    accessToken
  );

  const interactionItems = mediaInRange
    .map((x) => {
      const m = x.raw;

      // ✅ BUG PRINCIPAL: o client costuma devolver camelCase
      const likeValue = m?.likeCount ?? m?.like_count ?? 0;
      const commentsValue = m?.commentsCount ?? m?.comments_count ?? 0;

      const like = DataIntegrityGuard.nonNegativeInt("likeCount", likeValue);
      const comments = DataIntegrityGuard.nonNegativeInt(
        "commentsCount",
        commentsValue
      );

      const extra = savedSharesByMedia[x.id] ?? { saved: 0, shares: 0 };

      const saved = DataIntegrityGuard.nonNegativeInt("saved", extra.saved).value;
      const shares = DataIntegrityGuard.nonNegativeInt("shares", extra.shares).value;

      return {
        ymd: x.ymd,
        likes: like.value,
        comments: comments.value,
        shares,
        saved,
      };
    })
    .filter(Boolean) as Array<{
    ymd: ReturnType<typeof Ymd>;
    likes: number;
    comments: number;
    shares: number;
    saved: number;
  }>;

  const computed = DailyInteractionsCalculator.compute(range, interactionItems);

  return computed
    .map((d: any) => {
      const ymdStr = ymdToString(d?.ymd ?? d?.day ?? d?.date);
      const likes = safeInt(d?.likes);
      const comments = safeInt(d?.comments);
      const shares = safeInt(d?.shares);
      const saved = safeInt(d?.saved);

      const totalFromCalc =
        d?.totalInteractions ?? d?.total ?? d?.value ?? undefined;

      const totalInteractions =
        totalFromCalc != null
          ? safeInt(totalFromCalc)
          : safeInt(likes + comments + shares + saved);

      return {
        ...d,
        ymd: ymdStr ?? "",
        likes,
        comments,
        shares,
        saved,
        totalInteractions,
      };
    })
    .filter((x) => x.ymd);
}

export async function enrichDailyWithReachByMedia(
  graph: IInstagramGraphClient,
  mediaIds: string[],
  accessToken: string
): Promise<Record<string, number>> {
  const conc = ConcurrencyPolicy.limitFor("insights_per_media");

  const pairs = await mapLimit(mediaIds, conc, async (id) => {
    try {
      const reach = await (graph as any).getMediaReach({
        mediaId: id,
        accessToken,
        timeoutMs: 15000,
      });
      const fixed = DataIntegrityGuard.nonNegativeInt("reach", reach).value;
      return [id, fixed] as const;
    } catch {
      return [id, 0] as const;
    }
  });

  return Object.fromEntries(pairs);
}
