import type {
  IInstagramGraphClient,
  InstagramMediaItem,
} from "../../../application/interfaces/instagram/IInstagramGraphClient";
// import type { IInstagramGraphClient, InstagramMediaItem } from "../../application/ports/instagram/IInstagramGraphClient";

export type IgMedia = InstagramMediaItem;

export type IgMediaWithInsights = IgMedia & {
  reach: number;
  saves: number;
  shares: number;
};

function safeNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toMsStartUtc(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`).getTime();
}
function toMsEndUtc(ymd: string) {
  return new Date(`${ymd}T23:59:59.999Z`).getTime();
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let next = 0;

  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;

      try {
        results[i] = await fn(items[i]);
      } catch {
        results[i] = undefined;
      }
    }
  });

  await Promise.all(workers);
  return results;
}

export type GetMediaInsightsInput = {
  mediaId: string;
  accessToken: string;
  timeoutMs?: number;
};

export type MediaInsights = {
  reach: number;
  saves: number;
  shares: number;
};

type InstagramGraphClientWithInsights = IInstagramGraphClient & {
  getMediaInsights?: (input: GetMediaInsightsInput) => Promise<MediaInsights>;
};

export class InstagramPostInsightsService {
  constructor(private readonly igClient: InstagramGraphClientWithInsights) {}

  async fetchPostById(params: {
    accessToken: string;
    postId: string;
    igUserId: string;
  }): Promise<IgMediaWithInsights | null> {
    const { accessToken, postId, igUserId } = params;

    const found = await this.findMediaById({
      accessToken,
      igUserId,
      mediaId: postId,
      maxPages: 10,
      pageSize: 50,
    });

    if (!found) return null;

    const insights = await this.fetchMediaInsights({
      accessToken,
      mediaId: found.id,
    });

    return {
      ...found,
      reach: safeNum(insights.reach),
      saves: safeNum(insights.saves),
      shares: safeNum(insights.shares),
    };
  }

  async fetchBaselineMedia(params: {
    accessToken: string;
    igUserId: string;
    from: string; 
    to: string; 
    limit?: number;
  }): Promise<IgMediaWithInsights[]> {
    const { accessToken, igUserId } = params;

    const desired = Math.min(Math.max(Number(params.limit ?? 60), 5), 150);

    const fromMsRaw = toMsStartUtc(params.from);
    const toMsRaw = toMsEndUtc(params.to);

    const fromMs = Number.isFinite(fromMsRaw) ? fromMsRaw : 0;
    const toMs = Number.isFinite(toMsRaw) ? toMsRaw : Number.MAX_SAFE_INTEGER;

    const maxItemsToScan = Math.max(350, desired * 6);
    const maxPages = 20;

    const collected: IgMedia[] = [];
    const seen = new Set<string>();

    let after: string | undefined;
    let page = 0;
    let shouldStopByDate = false;

    while (page < maxPages && collected.length < maxItemsToScan && !shouldStopByDate) {
      page++;

      const pageOut = await this.igClient.getRecentMediaPaged({
        igUserId,
        accessToken,
        limit: 50,
        after,
        timeoutMs: 15000,
      });

      const rows = Array.isArray(pageOut?.data) ? pageOut.data : [];
      if (!rows.length) break;

      for (const m of rows) {
        const id = String(m?.id ?? "");
        if (!id || seen.has(id)) continue;

        seen.add(id);
        collected.push(m);

        const tsMs = m.timestamp ? m.timestamp.getTime() : NaN;
        if (Number.isFinite(tsMs) && tsMs < fromMs) {
          shouldStopByDate = true;
          break;
        }

        if (collected.length >= maxItemsToScan) break;
      }

      const nextAfter = pageOut?.paging?.cursors?.after;
      if (!nextAfter) break; 
      after = nextAfter;

      await sleep(150);
    }

    const inRange = collected.filter((m) => {
      const tsMs = m.timestamp ? m.timestamp.getTime() : NaN;
      if (!Number.isFinite(tsMs)) return false;
      return tsMs >= fromMs && tsMs <= toMs;
    });

    const filtered = inRange
      .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0))
      .slice(0, desired);

    const enrichedMaybe = await mapLimit(filtered, 2, async (m) => {
      await sleep(120);

      const insights = await this.fetchMediaInsights({
        accessToken,
        mediaId: m.id,
      });

      return {
        ...m,
        reach: safeNum(insights.reach),
        saves: safeNum(insights.saves),
        shares: safeNum(insights.shares),
      } satisfies IgMediaWithInsights;
    });

    return enrichedMaybe.filter(Boolean) as IgMediaWithInsights[];
  }

  private async fetchMediaInsights(params: {
    accessToken: string;
    mediaId: string;
  }): Promise<MediaInsights> {
    const { accessToken, mediaId } = params;

    if (typeof this.igClient.getMediaInsights === "function") {
      try {
        const r = await this.igClient.getMediaInsights({
          accessToken,
          mediaId,
          timeoutMs: 15000,
        });

        return {
          reach: safeNum(r?.reach),
          saves: safeNum(r?.saves),
          shares: safeNum(r?.shares),
        };
      } catch {
      }
    }

    try {
      const reach = await this.igClient.getMediaReach({
        accessToken,
        mediaId,
        timeoutMs: 15000,
      });

      return { reach: safeNum(reach), saves: 0, shares: 0 };
    } catch {
      return { reach: 0, saves: 0, shares: 0 };
    }
  }

  private async findMediaById(params: {
    accessToken: string;
    igUserId: string;
    mediaId: string;
    maxPages: number;
    pageSize: number;
  }): Promise<IgMedia | null> {
    const { accessToken, igUserId, mediaId, maxPages, pageSize } = params;

    let after: string | undefined;
    let page = 0;

    while (page < maxPages) {
      page++;

      const out = await this.igClient.getRecentMediaPaged({
        igUserId,
        accessToken,
        limit: pageSize,
        after,
        timeoutMs: 15000,
      });

      const rows = Array.isArray(out?.data) ? out.data : [];
      const found = rows.find((m) => String(m?.id) === String(mediaId));
      if (found) return found;

      const nextAfter = out?.paging?.cursors?.after;
      if (!nextAfter) break;
      after = nextAfter;

      await sleep(80);
    }

    return null;
  }
}
