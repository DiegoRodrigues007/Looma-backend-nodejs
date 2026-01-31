import type { IInstagramGraphClient } from "../../../application/ports/instagram/IInstagramGraphClient";
import {
  DateRangeYmd,
  Ymd,
  TopContentRanker,
  ConcurrencyPolicy,
  DataIntegrityGuard,
  InstagramDomainError,
} from "../../../domain/instagram";

export type TopContentItem = {
  id: string;
  permalink?: string;
  mediaType?: string;
  captionLength?: number;

  reach?: number;
  totalInteractions: number;
};

type FetchTopContentParams = {
  accessToken: string;
  igUserId: string;
  from: string; 
  to: string; 
  limit?: number;
};

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

export class InstagramTopContentService {
  constructor(private readonly graph: IInstagramGraphClient) {}

  async fetchTopContent({
    accessToken,
    igUserId,
    from,
    to,
    limit = 10,
  }: FetchTopContentParams): Promise<TopContentItem[]> {
    if (!accessToken) {
      throw new InstagramDomainError({
        code: "INVALID_TOKEN",
        message: "accessToken is required",
        retryable: false,
      });
    }
    if (!igUserId) throw InstagramDomainError.invalidInput("igUserId is required");
    if (!from || !to) throw InstagramDomainError.invalidInput("from/to are required");

    const range = DateRangeYmd(from, to);

    const desired = Math.max(limit * 6, 40); 
    const pageLimit = 50;
    const maxPages = 6;

    const fields =
      "id,caption,media_type,permalink,timestamp,like_count,comments_count";

    const allMedia: any[] = [];
    let after: string | undefined = undefined;

    for (let page = 0; page < maxPages && allMedia.length < desired; page++) {
      const resp = await this.graph.getRecentMediaPaged({
        igUserId,
        accessToken,
        limit: pageLimit,
        after,
        fields,
        timeoutMs: 15000,
      });

      const batch = Array.isArray(resp.data) ? resp.data : [];
      allMedia.push(...batch);

      const nextAfter = resp.paging?.cursors?.after;
      if (!nextAfter) break;
      after = nextAfter;
    }

    const inRange = allMedia
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

        const like = DataIntegrityGuard.nonNegativeInt("like_count", m.like_count);
        const comments = DataIntegrityGuard.nonNegativeInt("comments_count", m.comments_count);

        const caption = String(m.caption ?? "");

        const totalInteractions = like.value + comments.value;

        return {
          id: String(m.id),
          ymd,
          permalink: m.permalink ? String(m.permalink) : undefined,
          mediaType: m.media_type ? String(m.media_type) : undefined,
          captionLength: caption.length,
          likeCount: like.value,
          commentsCount: comments.value,
          totalInteractions,
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        ymd: ReturnType<typeof Ymd>;
        permalink?: string;
        mediaType?: string;
        captionLength?: number;
        likeCount: number;
        commentsCount: number;
        totalInteractions: number;
      }>;

    if (!inRange.length) return [];

    const scoredCandidates = TopContentRanker.rank(
      inRange.map((m) => ({
        id: m.id,
        ymd: m.ymd,
        likeCount: m.likeCount,
        commentsCount: m.commentsCount,
        shares: 0,
        saved: 0,
      })),
      { topK: Math.max(limit, 10), tieBreak: "recent_first" }
    );

    const candidates: TopContentItem[] = scoredCandidates.map((s) => {
      const meta = inRange.find((x) => x.id === s.id);
      return {
        id: s.id,
        permalink: meta?.permalink,
        mediaType: meta?.mediaType,
        captionLength: meta?.captionLength,
        totalInteractions: s.total,
        reach: 0,
      };
    });

    const conc = ConcurrencyPolicy.limitFor("insights_per_media");

    const enriched = await mapLimit(candidates, conc, async (item) => {
      try {
        const reach = await this.graph.getMediaReach({
          mediaId: item.id,
          accessToken,
          timeoutMs: 15000,
        });

        const reachFixed = DataIntegrityGuard.nonNegativeInt("reach", reach).value;

        return { ...item, reach: reachFixed };
      } catch {
        return { ...item, reach: 0 };
      }
    });

    const finalRank = TopContentRanker.rank(
      enriched.map((e) => ({
        id: e.id,
        ymd: range.to,
        likeCount: e.totalInteractions,
        commentsCount: 0,
        shares: 0,
        saved: 0,
      })),
      { topK: Math.max(1, limit), tieBreak: "stable" }
    );

    const order = new Map(finalRank.map((x, i) => [x.id, i]));

    return enriched
      .slice()
      .sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999))
      .slice(0, limit);
  }
}
