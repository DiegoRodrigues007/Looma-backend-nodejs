function avg(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export type MediaTypeBucket = {
  mediaType: string;
  sample: number;
  avgReach: number;
  avgInteractions: number;
};

export type HourWindowBucket = {
  label: string;
  fromHour: number;
  toHour: number;
  sample: number;
  avgReach: number;
};

export type BucketInputItem = {
  mediaType: string;
  hour: number;
  reach: number;
  interactions: number;
};

export function buildMediaTypeBuckets(items: BucketInputItem[]): MediaTypeBucket[] {
  const byType = new Map<string, BucketInputItem[]>();

  for (const x of items ?? []) {
    const key = String(x.mediaType ?? "UNKNOWN");
    const arr = byType.get(key) ?? [];
    arr.push(x);
    byType.set(key, arr);
  }

  return Array.from(byType.entries()).map(([mediaType, group]) => ({
    mediaType,
    sample: group.length,
    avgReach: avg(group.map((x) => x.reach)),
    avgInteractions: avg(group.map((x) => x.interactions)),
  }));
}

const DEFAULT_2H_WINDOWS = [
  { label: "00:00–02:00", from: 0, to: 2 },
  { label: "02:00–04:00", from: 2, to: 4 },
  { label: "04:00–06:00", from: 4, to: 6 },
  { label: "06:00–08:00", from: 6, to: 8 },
  { label: "08:00–10:00", from: 8, to: 10 },
  { label: "10:00–12:00", from: 10, to: 12 },
  { label: "12:00–14:00", from: 12, to: 14 },
  { label: "14:00–16:00", from: 14, to: 16 },
  { label: "16:00–18:00", from: 16, to: 18 },
  { label: "18:00–20:00", from: 18, to: 20 },
  { label: "20:00–22:00", from: 20, to: 22 },
  { label: "22:00–24:00", from: 22, to: 24 },
];

export function buildHourWindowBuckets(
  items: BucketInputItem[],
  windows = DEFAULT_2H_WINDOWS
): HourWindowBucket[] {
  return windows.map((w) => {
    const group = (items ?? []).filter((x) => x.hour >= w.from && x.hour < w.to);
    return {
      label: w.label,
      fromHour: w.from,
      toHour: w.to,
      sample: group.length,
      avgReach: avg(group.map((x) => x.reach)),
    };
  });
}
