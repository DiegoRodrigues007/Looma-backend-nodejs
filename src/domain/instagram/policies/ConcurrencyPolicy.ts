export type ConcurrencyClass =
  | "insights_per_media"
  | "media_pagination"
  | "dashboard_metrics";

export type ConcurrencyLimits = Record<ConcurrencyClass, number>;

export const DefaultConcurrencyLimits: ConcurrencyLimits = {
  insights_per_media: 3,
  media_pagination: 1,
  dashboard_metrics: 2,
};

export const ConcurrencyPolicy = {
  limitFor(kind: ConcurrencyClass, overrides?: Partial<ConcurrencyLimits>): number {
    const merged = { ...DefaultConcurrencyLimits, ...(overrides ?? {}) };
    const n = Number(merged[kind]);
    if (!Number.isFinite(n) || n <= 0) return DefaultConcurrencyLimits[kind];
    return Math.floor(n);
  },
};
