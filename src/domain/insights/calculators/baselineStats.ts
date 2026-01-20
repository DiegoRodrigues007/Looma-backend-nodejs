import { computeCtaEffect } from "./ctaEffect";
import { buildHourWindowBuckets, buildMediaTypeBuckets } from "./contentBuckets";

function avg(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export type BaselineNormalizedItem = {
  id: string;
  ts: string;

  hour: number;
  mediaType: string;
  hasCTA: boolean;

  reach: number;
  likes: number;
  comments: number;
  interactions: number;
  saves: number;
  shares: number;
};

export type BaselineStats = {
  overall: {
    avgReach: number;
    avgLikes: number;
    avgComments: number;
    avgInteractions: number;
    avgSaves: number;
    avgShares: number;
  };

  byHourWindow: Array<{
    label: string;
    fromHour: number;
    toHour: number;
    sample: number;
    avgReach: number;
  }>;

  byMediaType: Array<{
    mediaType: string;
    sample: number;
    avgReach: number;
    avgInteractions: number;
  }>;

  ctaEffect: {
    withCTA: {
      sample: number;
      avgComments: number;
      avgSaves: number;
      avgInteractions: number;
    };
    withoutCTA: {
      sample: number;
      avgComments: number;
      avgSaves: number;
      avgInteractions: number;
    };
  };

  sampleSize: number;
};

export function computeBaselineStats(items: BaselineNormalizedItem[]): BaselineStats {
  const normalized = items ?? [];

  const overall = {
    avgReach: avg(normalized.map((x) => x.reach)),
    avgLikes: avg(normalized.map((x) => x.likes)),
    avgComments: avg(normalized.map((x) => x.comments)),
    avgInteractions: avg(normalized.map((x) => x.interactions)),
    avgSaves: avg(normalized.map((x) => x.saves)),
    avgShares: avg(normalized.map((x) => x.shares)),
  };

  const byHourWindow = buildHourWindowBuckets(normalized).map((w) => ({
    label: w.label,
    fromHour: w.fromHour,
    toHour: w.toHour,
    sample: w.sample,
    avgReach: w.avgReach,
  }));

  const byMediaType = buildMediaTypeBuckets(normalized).map((b) => ({
    mediaType: b.mediaType,
    sample: b.sample,
    avgReach: b.avgReach,
    avgInteractions: b.avgInteractions,
  }));

  const ctaEffect = computeCtaEffect(
    normalized.map((x) => ({
      hasCTA: x.hasCTA,
      comments: x.comments,
      saves: x.saves,
      interactions: x.interactions,
    }))
  );

  return {
    overall,
    byHourWindow,
    byMediaType,
    ctaEffect,
    sampleSize: normalized.length,
  };
}
