// src/domain/instagram/metricsWindows.ts

export type InstagramTimeseriesPoint = {
  date: string; // YYYY-MM-DD
  followers: number;
  reach: number;
  profileViews: number;
  totalInteractions: number;
  engagementRate: number; // %
};

export type InstagramWindowSummary = {
  reach: number;
  profileViews: number;
  totalInteractions: number;
  engagementRate: number; // %
};

function toFiniteNumber(v: any): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function windowAgg(
  timeseries: InstagramTimeseriesPoint[],
  windowDays: number
): InstagramWindowSummary {
  const slice = timeseries.slice(Math.max(0, timeseries.length - windowDays));

  const reach = slice.reduce((acc, x) => acc + toFiniteNumber(x.reach), 0);
  const profileViews = slice.reduce(
    (acc, x) => acc + toFiniteNumber(x.profileViews),
    0
  );
  const totalInteractions = slice.reduce(
    (acc, x) => acc + toFiniteNumber(x.totalInteractions),
    0
  );

  const engagementRate = reach > 0 ? (totalInteractions / reach) * 100 : 0;

  return { reach, profileViews, totalInteractions, engagementRate };
}

export function buildWindowsSummary(timeseries: InstagramTimeseriesPoint[]) {
  return {
    last7d: windowAgg(timeseries, 7),
    last30d: windowAgg(timeseries, 30),
  };
}
