import type { DateRangeYmd, Ymd } from "../value-objects/DateRangeYmd";
import { eachDayInclusive } from "../value-objects/DateRangeYmd";

export type DailyInteractions = {
  ymd: Ymd;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  total: number;
};

export type InteractionItem = {
  ymd: Ymd;
  likes?: number;
  comments?: number;
  shares?: number;
  saved?: number;
};

function nz(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export const DailyInteractionsCalculator = {

  compute(range: DateRangeYmd, items: InteractionItem[]): DailyInteractions[] {
    const map = new Map<string, DailyInteractions>();

    for (const it of items) {
      const key = it.ymd;
      const cur = map.get(key) ?? {
        ymd: key,
        likes: 0,
        comments: 0,
        shares: 0,
        saved: 0,
        total: 0,
      };

      cur.likes += nz(it.likes);
      cur.comments += nz(it.comments);
      cur.shares += nz(it.shares);
      cur.saved += nz(it.saved);
      cur.total = cur.likes + cur.comments + cur.shares + cur.saved;

      map.set(key, cur);
    }

    const days = eachDayInclusive(range);
    return days.map((d) => map.get(d) ?? {
      ymd: d,
      likes: 0,
      comments: 0,
      shares: 0,
      saved: 0,
      total: 0,
    });
  },
};
