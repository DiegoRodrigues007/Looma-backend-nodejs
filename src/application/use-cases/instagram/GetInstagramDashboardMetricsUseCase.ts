import type { PrismaClient } from "@prisma/client";
import {
  buildWindowsSummary,
  type InstagramTimeseriesPoint,
} from "../../../domain/services/metricsWindows";

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

  // range
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD

  // conta ativa já resolvida no controller (ou você pode resolver aqui futuramente)
  instagramAccountId: string;
  igUserId: string;
  pageAccessToken: string;

  // flags
  force?: boolean;
  refillZeros?: boolean;

  // política de refetch
  alwaysRefetchLastDays?: number; // default 7
  maxRangeDays?: number; // default 92
};

function s(v: any): string {
  return String(v ?? "").trim();
}

function toFiniteNumber(v: any): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ymd(d: Date): string {
  // YYYY-MM-DD em UTC
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

function isRowAllZero(r: any): boolean {
  const reach = toFiniteNumber(r?.reach);
  const pv = toFiniteNumber(r?.profileViewsTotal);
  const ti = toFiniteNumber(r?.totalInteractions);
  return reach === 0 && pv === 0 && ti === 0;
}

export class GetInstagramDashboardMetricsUseCase {
  constructor(
    private readonly prisma: PrismaClient,
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

    // 1) carrega existentes
    const existing = await this.prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId,
        instagramAccountId,
        day: {
          gte: dateOnlyUtcFromYmd(safeFrom),
          lte: dateOnlyUtcFromYmd(safeTo),
        },
      },
      orderBy: { day: "asc" },
    });

    const byDayExisting = new Map<string, any>();
    for (const r of existing) byDayExisting.set(ymd(r.day), r);

    // 2) decide dias pra refetch:
    // - force => tudo
    // - senão => sempre últimos N dias + faltantes + (se refillZeros) all-zero
    const tailSet = new Set(
      days.slice(Math.max(0, days.length - alwaysRefetchLastDays))
    );

    const daysToFetch = force
      ? [...days]
      : days.filter((d) => {
          const r = byDayExisting.get(d);
          if (!r) return true; // faltante
          if (tailSet.has(d)) return true; // ✅ sempre refaz últimos N dias
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
    const rows = (await this.prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId,
        instagramAccountId,
        day: {
          gte: dateOnlyUtcFromYmd(safeFrom),
          lte: dateOnlyUtcFromYmd(safeTo),
        },
      },
      orderBy: { day: "asc" },
    })) as unknown as DailyMetricRow[];

    const byDay: Record<string, DailyMetricRow> = {};
    for (const r of rows) byDay[ymd(r.day)] = r;

    // 5) monta timeseries alinhado aos dias (mesmo se faltar algum, ele entra 0)
    const timeseries: InstagramTimeseriesPoint[] = days.map((day) => {
      const r = byDay[day];
      const followers = toFiniteNumber(r?.followers);
      const reach = toFiniteNumber(r?.reach);
      const profileViews = toFiniteNumber(r?.profileViewsTotal);
      const totalInteractions = toFiniteNumber(r?.totalInteractions);
      const engagementRate = reach > 0 ? (totalInteractions / reach) * 100 : 0;

      return {
        date: day,
        followers,
        reach,
        profileViews,
        totalInteractions,
        engagementRate,
      };
    });

    // 6) KPIs (mantém compatível com teu retorno atual)
    const totalReach = timeseries.reduce((a, b) => a + toFiniteNumber(b.reach), 0);
    const totalInteractions = timeseries.reduce(
      (a, b) => a + toFiniteNumber(b.totalInteractions),
      0
    );

    const avgEngagementRate =
      timeseries.reduce((a, b) => a + toFiniteNumber(b.engagementRate), 0) /
      Math.max(1, timeseries.length);

    const followers =
      timeseries.length > 0 ? toFiniteNumber(timeseries[timeseries.length - 1].followers) : 0;

    // 7) summary 7d / 30d (aqui é o que você quer pro dashboard)
    const summary = buildWindowsSummary(timeseries);

    return {
      ok: true,
      instagramAccountIdUsed: instagramAccountId,
      filters: { from: safeFrom, to: safeTo },

      kpis: {
        followers,
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
