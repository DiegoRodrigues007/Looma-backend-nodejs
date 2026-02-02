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

export type DailyInteractions = ReturnType<typeof DailyInteractionsCalculator.compute>[number];

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

function safeIsoToYmd(isoMaybe: unknown): string | null {
  const s = String(isoMaybe ?? "").trim();
  if (!s) return null;
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

export async function fetchDailyInteractionsByPosts(
  graph: IInstagramGraphClient,
  input: FetchDailyInteractionsByPostsInput
): Promise<DailyInteractions[]> {
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

  const pageLimit = Math.max(1, Math.min(50, Math.floor(input.pageLimit ?? 50)));

  const days = daysInclusive(range.from, range.to);

  const maxPosts = Math.max(30, Math.min(500, Math.floor(input.maxPosts ?? days * 15)));

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
    } catch (e: any) {
      break;
    }
  }

  const interactionItems = media
    .map((m) => {
      const ymdStr = safeIsoToYmd(m.timestamp);
      if (!ymdStr) return null;

      let ymd: ReturnType<typeof Ymd>;
      try {
        ymd = Ymd(ymdStr);
      } catch {
        return null;
      }

      if (ymd < range.from || ymd > range.to) return null;

      const like = DataIntegrityGuard.nonNegativeInt("like_count", (m as any).like_count);
      const comments = DataIntegrityGuard.nonNegativeInt("comments_count", (m as any).comments_count);

      return {
        ymd,
        likes: like.value,
        comments: comments.value,
        shares: 0,
        saved: 0,
      };
    })
    .filter(Boolean) as Array<{
    ymd: ReturnType<typeof Ymd>;
    likes: number;
    comments: number;
    shares: number;
    saved: number;
  }>;

  return DailyInteractionsCalculator.compute(range, interactionItems);
}


export async function enrichDailyWithReachByMedia(
  graph: IInstagramGraphClient,
  mediaIds: string[],
  accessToken: string
): Promise<Record<string, number>> {
  const conc = ConcurrencyPolicy.limitFor("insights_per_media");

  const pairs = await mapLimit(mediaIds, conc, async (id) => {
    try {
      const reach = await graph.getMediaReach({ mediaId: id, accessToken, timeoutMs: 15000 });
      const fixed = DataIntegrityGuard.nonNegativeInt("reach", reach).value;
      return [id, fixed] as const;
    } catch {
      return [id, 0] as const;
    }
  });

  return Object.fromEntries(pairs);
}
