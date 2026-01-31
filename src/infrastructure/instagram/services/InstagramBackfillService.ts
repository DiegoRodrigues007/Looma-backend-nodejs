import axios from "axios";
import { prisma } from "../../db/prismaClient";
import { toFiniteNumber } from "../../../domain/metrics/instagram/instagramInsightsMapper";
import type {
  IInstagramBackfillService,
  BackfillDailyMetricsResult,
} from "../../../application/ports/instagram/IInstagramBackfillService";

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function dateOnlyUtcFromYmd(ymdStr: string): Date {
  return new Date(`${ymdStr.slice(0, 10)}T00:00:00.000Z`);
}

type IgInsightsResponse = {
  data?: Array<{
    name?: string;
    values?: Array<{ value?: unknown; end_time?: string }>;
  }>;
};

function pickInsightValueByMetric(
  insights: IgInsightsResponse | null | undefined,
  metricName: string
): number {
  const rows = insights?.data ?? [];
  const row = rows.find((r) => String(r?.name ?? "") === metricName);
  const v0 = row?.values?.[0]?.value;

  const parseAny = (v: unknown, depth = 0): number => {
    if (depth > 6) return 0;

    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") return Number(v) || 0;

    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      if ("total_value" in obj) return parseAny((obj as any).total_value, depth + 1);
      if ("value" in obj) return parseAny((obj as any).value, depth + 1);

      const tv = (obj as any)?.total_value?.value;
      if (tv !== undefined) return parseAny(tv, depth + 1);
    }

    return 0;
  };

  return parseAny(v0);
}

async function runPromisePool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  const queue = items.slice();
  const runners = new Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        await worker(item);
      }
    });

  await Promise.allSettled(runners);
}

async function fetchDailyInsightsFromGraph(params: {
  igUserId: string;
  pageAccessToken: string;
  dayYmd: string;
}): Promise<{
  reach: number;
  profileViews: number;
  totalInteractions: number;
}> {
  const igUserId = s(params.igUserId);
  const token = s(params.pageAccessToken);
  const day = s(params.dayYmd).slice(0, 10);

  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const sinceTs = Math.floor(dayStart.getTime() / 1000);
  const untilTs = sinceTs + 86400;

  const base = `https://graph.facebook.com/v21.0/${encodeURIComponent(igUserId)}`;

  const insightsUrlA =
    `${base}/insights` +
    `?metric=reach` +
    `&period=day` +
    `&since=${sinceTs}` +
    `&until=${untilTs}` +
    `&access_token=${encodeURIComponent(token)}`;

  const insightsUrlB =
    `${base}/insights` +
    `?metric=profile_views,total_interactions` +
    `&metric_type=total_value` +
    `&period=day` +
    `&since=${sinceTs}` +
    `&until=${untilTs}` +
    `&access_token=${encodeURIComponent(token)}`;

  let insightsA: IgInsightsResponse | null = null;
  let insightsB: IgInsightsResponse | null = null;

  try {
    const rA = await axios.get<IgInsightsResponse>(insightsUrlA, { timeout: 15000 });
    insightsA = rA.data;
  } catch (e: unknown) {
    const err = e as any;
    const graphError = err?.response?.data?.error;
    const msg = String(graphError?.message ?? err?.message ?? "Erro Graph A");
    throw new Error(`Graph /insights(A) falhou (${day}): ${msg}`);
  }

  try {
    const rB = await axios.get<IgInsightsResponse>(insightsUrlB, { timeout: 15000 });
    insightsB = rB.data;
  } catch {
    insightsB = { data: [] };
  }

  const rowsA = insightsA?.data ?? [];
  if (!Array.isArray(rowsA) || rowsA.length === 0) {
    throw new Error(`Graph /insights(A) veio vazio (${day}).`);
  }

  const reach = toFiniteNumber(pickInsightValueByMetric(insightsA, "reach"));
  const profileViews = toFiniteNumber(pickInsightValueByMetric(insightsB, "profile_views"));
  const totalInteractions = toFiniteNumber(
    pickInsightValueByMetric(insightsB, "total_interactions")
  );

  return { reach, profileViews, totalInteractions };
}

export class InstagramBackfillService implements IInstagramBackfillService {
  async backfillDailyMetrics(args: {
    requestId?: string;
    userId: string;
    instagramAccountId: string;
    igUserId: string;
    pageAccessToken: string;
    days: string[];
    concurrency: number;
  }): Promise<BackfillDailyMetricsResult> {
    const userId = s(args.userId);
    const instagramAccountId = s(args.instagramAccountId);
    const igUserId = s(args.igUserId);
    const pageAccessToken = s(args.pageAccessToken);

    const days = Array.isArray(args.days) ? args.days.map((d) => s(d).slice(0, 10)) : [];
    const concurrency = Math.max(1, Number(args.concurrency ?? 2) || 2);

    const errors: Array<{ day: string; message: string }> = [];
    let fetchedDays = 0;

    await runPromisePool(days, concurrency, async (dayYmd) => {
      try {
        const g = await fetchDailyInsightsFromGraph({
          igUserId,
          pageAccessToken,
          dayYmd,
        });

        await prisma.instagramAccountDailyMetrics.upsert({
          where: {
            instagramAccountId_day: {
              instagramAccountId,
              day: dateOnlyUtcFromYmd(dayYmd),
            },
          },
          create: {
            userId,
            instagramAccountId,
            day: dateOnlyUtcFromYmd(dayYmd),
            followers: null,
            profileViewsTotal: toFiniteNumber(g.profileViews),
            reach: toFiniteNumber(g.reach),
            totalInteractions: toFiniteNumber(g.totalInteractions),
          },
          update: {
            followers: null,
            profileViewsTotal: toFiniteNumber(g.profileViews),
            reach: toFiniteNumber(g.reach),
            totalInteractions: toFiniteNumber(g.totalInteractions),
          },
        });

        fetchedDays++;
      } catch (e: unknown) {
        const err = e as any;
        errors.push({ day: dayYmd, message: String(err?.message ?? "erro") });
      }
    });

    return { fetchedDays, errors };
  }

  async getFollowersCountNow(args: {
    igUserId: string;
    pageAccessToken: string;
  }): Promise<number> {
    const igUserId = s(args.igUserId);
    const token = s(args.pageAccessToken);

    const url =
      `https://graph.facebook.com/v21.0/${encodeURIComponent(igUserId)}` +
      `?fields=followers_count` +
      `&access_token=${encodeURIComponent(token)}`;

    try {
      const r = await axios.get<{ followers_count?: number }>(url, { timeout: 15000 });
      return toFiniteNumber(r.data?.followers_count);
    } catch {
      return 0;
    }
  }
}
