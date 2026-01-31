import type { Ymd } from "../value-objects/DateRangeYmd";

export type ContentScoreInput = {
  id: string;
  ymd: Ymd;
  likeCount: number;
  commentsCount: number;
  shares: number;
  saved: number;
};

export type ContentScore = ContentScoreInput & {
  total: number;
};

export type RankOptions = {
  topK: number;
  tieBreak?: "recent_first" | "oldest_first" | "stable";
};

function nz(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function score(item: ContentScoreInput): ContentScore {
  const likeCount = nz(item.likeCount);
  const commentsCount = nz(item.commentsCount);
  const shares = nz(item.shares);
  const saved = nz(item.saved);

  return {
    ...item,
    likeCount,
    commentsCount,
    shares,
    saved,
    total: likeCount + commentsCount + shares + saved,
  };
}

export const TopContentRanker = {
  rank(items: ContentScoreInput[], opts: RankOptions): ContentScore[] {
    const topK = Math.max(1, Math.floor(opts.topK));
    const tieBreak = opts.tieBreak ?? "recent_first";

    const scored = items.map(score);

    scored.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;

      if (tieBreak === "stable") return 0;

      if (tieBreak === "recent_first") {
        if (b.ymd !== a.ymd) return b.ymd.localeCompare(a.ymd);
      } else if (tieBreak === "oldest_first") {
        if (a.ymd !== b.ymd) return a.ymd.localeCompare(b.ymd);
      }

      return a.id.localeCompare(b.id);
    });

    return scored.slice(0, topK);
  },
};
