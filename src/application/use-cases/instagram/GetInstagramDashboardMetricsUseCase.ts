import {
  buildWindowsSummary,
  type InstagramTimeseriesPoint,
} from "../../../domain/metrics/windows/metricsWindows";

import type { IMetricsSnapshotRepository } from "../../ports/db/IMetricsSnapshotRepository";
import type { IInstagramDailyMetricsRepository } from "../../ports/db/IInstagramDailyMetricsRepository";

type DailyMetricRow = {
  day: Date;
  followers: number | null;
  reach: number | null;
  profileViewsTotal: number | null;
  totalInteractions: number | null;
};

export type DashboardMetricsResult = {
  ok: true;
  instagramAccountIdUsed: string;
  filters: { from: string; to: string };

  kpis: {
    followers: number;

    followersTotal: number;
    followersGained: number;
    followersLost: number;

    reach: number;
    totalInteractions: number;
    engagementRate: number;
  };

  timeseries: InstagramTimeseriesPoint[];

  summary: {
    last7d: {
      reach: number;
      profileViews: number;
      totalInteractions: number;
      engagementRate: number;
    };
    last30d: {
      reach: number;
      profileViews: number;
      totalInteractions: number;
      engagementRate: number;
    };
  };

  meta: {
    requestedFetchDays: number;
    filledDays: number;
    errorsCount: number;
    errorsPreview: Array<{ day: string; message: string }>;
  };
};

export type BackfillResult = {
  filledDays: number;
  errors: Array<{ day: string; message: string }>;
};

export type BackfillDaysFn = (args: {
  userId: string;
  instagramAccountId: string;
  igUserId: string;
  pageAccessToken: string;
  days: string[]; // YYYY-MM-DD
  requestId: string;
}) => Promise<BackfillResult>;

export type GetInstagramDashboardMetricsParams = {
  requestId: string;
  userId: string;

  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD

  instagramAccountId: string;
  igUserId: string;
  pageAccessToken: string;

  force?: boolean;
  refillZeros?: boolean;

  alwaysRefetchLastDays?: number; // default 7
  maxRangeDays?: number; // default 92
};

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function toFiniteNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ymd(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateOnlyUtcFromYmd(ymdStr: string): Date {
  return new Date(`${ymdStr.slice(0, 10)}T00:00:00.000Z`);
}

function listDays(from: string, to: string): string[] {
  const start = dateOnlyUtcFromYmd(from);
  const end = dateOnlyUtcFromYmd(to);
  const out: string[] = [];

  let cur = start;
  while (cur.getTime() <= end.getTime()) {
    out.push(ymd(cur));
    cur = new Date(cur.getTime() + 86400 * 1000);
  }
  return out;
}

function clampRangeDays(from: string, to: string, maxDays: number) {
  const days = listDays(from, to);
  if (days.length <= maxDays) return { days, from, to };

  const tail = days.slice(days.length - maxDays);
  return { days: tail, from: tail[0], to: tail[tail.length - 1] };
}

function isRowAllZero(
  r:
    | Pick<DailyMetricRow, "reach" | "profileViewsTotal" | "totalInteractions">
    | undefined
): boolean {
  if (!r) return true;
  const reach = toFiniteNumber(r.reach);
  const pv = toFiniteNumber(r.profileViewsTotal);
  const ti = toFiniteNumber(r.totalInteractions);
  return reach === 0 && pv === 0 && ti === 0;
}

function addDaysYmd(day: string, deltaDays: number): string {
  const d = dateOnlyUtcFromYmd(day);
  const x = new Date(d.getTime() + deltaDays * 86400 * 1000);
  return ymd(x);
}

export class GetInstagramDashboardMetricsUseCase {
  constructor(
    private readonly dailyMetricsRepo: IInstagramDailyMetricsRepository,
    private readonly metricsSnapshotRepo: IMetricsSnapshotRepository,
    private readonly backfillDays: BackfillDaysFn
  ) {}

  async execute(
    params: GetInstagramDashboardMetricsParams
  ): Promise<DashboardMetricsResult> {
    const requestId = s(params.requestId);

    const userId = s(params.userId);
    const instagramAccountId = s(params.instagramAccountId);
    const igUserId = s(params.igUserId);
    const pageAccessToken = s(params.pageAccessToken);

    const from = s(params.from).slice(0, 10);
    const to = s(params.to).slice(0, 10);

    const force = params.force ?? false;
    const refillZeros = params.refillZeros ?? true;

    const maxRangeDays = params.maxRangeDays ?? 92;
    const alwaysRefetchLastDays = params.alwaysRefetchLastDays ?? 7;

    if (!from || !to || from > to) {
      throw new Error("Range inválido (from/to).");
    }

    const { days, from: safeFrom, to: safeTo } = clampRangeDays(
      from,
      to,
      maxRangeDays
    );

    // 1) carrega existentes (tipado)
    const existing: DailyMetricRow[] = await this.dailyMetricsRepo.listByRange({
      userId,
      instagramAccountId,
      from: dateOnlyUtcFromYmd(safeFrom),
      to: dateOnlyUtcFromYmd(safeTo),
    });

    const byDayExisting = new Map<string, DailyMetricRow>();
    for (const r of existing) byDayExisting.set(ymd(r.day), r);

    // 2) decide dias pra refetch
    const tailSet = new Set(
      days.slice(Math.max(0, days.length - alwaysRefetchLastDays))
    );

    const daysToFetch = force
      ? [...days]
      : days.filter((d) => {
          const r = byDayExisting.get(d);
          if (!r) return true; // faltante
          if (tailSet.has(d)) return true; // sempre refaz últimos N dias
          if (!refillZeros) return false;
          return isRowAllZero(r); // zeros antigos
        });

    // 3) backfill (Graph) - via dependência
    const backfill = daysToFetch.length
      ? await this.backfillDays({
          userId,
          instagramAccountId,
          igUserId,
          pageAccessToken,
          days: daysToFetch,
          requestId,
        })
      : { filledDays: 0, errors: [] as Array<{ day: string; message: string }> };

    // 4) carrega do banco após backfill
    const rows: DailyMetricRow[] = await this.dailyMetricsRepo.listByRange({
      userId,
      instagramAccountId,
      from: dateOnlyUtcFromYmd(safeFrom),
      to: dateOnlyUtcFromYmd(safeTo),
    });

    const byDay: Record<string, DailyMetricRow> = {};
    for (const r of rows) byDay[ymd(r.day)] = r;

    // 5) monta timeseries alinhado aos dias
    const timeseries: InstagramTimeseriesPoint[] = days.map((day) => {
      const r = byDay[day];
      const reach = toFiniteNumber(r?.reach);
      const profileViews = toFiniteNumber(r?.profileViewsTotal);
      const totalInteractions = toFiniteNumber(r?.totalInteractions);
      const engagementRate = reach > 0 ? (totalInteractions / reach) * 100 : 0;

      return {
        date: day,
        followers: 0, // ✅ mantém 0 na série
        reach,
        profileViews,
        totalInteractions,
        engagementRate,
      };
    });

    // 6) KPIs
    const totalReach = timeseries.reduce((a, b) => a + toFiniteNumber(b.reach), 0);
    const totalInteractions = timeseries.reduce(
      (a, b) => a + toFiniteNumber(b.totalInteractions),
      0
    );

    const avgEngagementRate =
      timeseries.reduce((a, b) => a + toFiniteNumber(b.engagementRate), 0) /
      Math.max(1, timeseries.length);

    // 7) Followers POR CONTA (prioriza daily; fallback snapshot global)
    const dayTo = safeTo;
    const dayPrev = addDaysYmd(safeTo, -1);

    const dailyTo = byDay[dayTo];
    const dailyPrev = byDay[dayPrev];

    let followersTotal = toFiniteNumber(dailyTo?.followers ?? 0);
    let followersPrev = toFiniteNumber(dailyPrev?.followers ?? 0);

    if (followersTotal === 0 || followersPrev === 0) {
      const [snapTo, snapPrev] = await Promise.all([
        this.metricsSnapshotRepo.getFollowersByUserPlatformDate({
          userId,
          platform: "instagram",
          date: dateOnlyUtcFromYmd(dayTo),
        }),
        this.metricsSnapshotRepo.getFollowersByUserPlatformDate({
          userId,
          platform: "instagram",
          date: dateOnlyUtcFromYmd(dayPrev),
        }),
      ]);

      const snapFollowersTotal = toFiniteNumber(snapTo ?? 0);
      const snapFollowersPrev = toFiniteNumber(snapPrev ?? 0);

      if (followersTotal === 0) followersTotal = snapFollowersTotal;
      if (followersPrev === 0) followersPrev = snapFollowersPrev;
    }

    const diff = followersTotal - followersPrev;
    const followersGained = diff > 0 ? diff : 0;
    const followersLost = diff < 0 ? Math.abs(diff) : 0;

    // 8) summary 7d / 30d
    const summary = buildWindowsSummary(timeseries);

    return {
      ok: true,
      instagramAccountIdUsed: instagramAccountId,
      filters: { from: safeFrom, to: safeTo },

      kpis: {
        followers: followersTotal,
        followersTotal,
        followersGained,
        followersLost,

        reach: totalReach,
        totalInteractions,
        engagementRate: avgEngagementRate,
      },

      timeseries,
      summary,

      meta: {
        requestedFetchDays: daysToFetch.length,
        filledDays: backfill.filledDays,
        errorsCount: backfill.errors.length,
        errorsPreview: backfill.errors.slice(0, 10),
      },
    };
  }
}
