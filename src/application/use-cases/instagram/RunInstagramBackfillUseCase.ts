// src/application/use-cases/instagram/RunInstagramBackfillUseCase.ts
import axios from "axios";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { listDays, ymd } from "../../../shared/date/instagramDateUtils";
import { toFiniteNumber } from "../../../domain/metrics/instagram/instagramInsightsMapper";

function s(v: any): string {
  return String(v ?? "").trim();
}

function dateOnlyUtcFromYmd(ymdStr: string): Date {
  return new Date(`${ymdStr.slice(0, 10)}T00:00:00.000Z`);
}

function clampRangeDays(from: string, to: string, maxDays = 92) {
  const days = listDays(from, to);
  if (days.length <= maxDays) return { days, from, to };
  const tail = days.slice(days.length - maxDays);
  return { days: tail, from: tail[0], to: tail[tail.length - 1] };
}

type IgInsightsResponse = {
  data?: Array<{
    name?: string;
    values?: Array<{ value?: any; end_time?: string }>;
  }>;
};

function pickInsightValueByMetric(
  insights: IgInsightsResponse | null | undefined,
  metricName: string
): number {
  const rows = insights?.data ?? [];
  const row = rows.find((r) => String(r?.name ?? "") === metricName);
  const v0 = row?.values?.[0]?.value;

  const parseAny = (v: any, depth = 0): number => {
    if (depth > 6) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") return Number(v) || 0;

    if (v && typeof v === "object") {
      if ("total_value" in v) return parseAny((v as any).total_value, depth + 1);
      if ("value" in v) return parseAny((v as any).value, depth + 1);
      const tv = (v as any)?.total_value?.value;
      if (tv !== undefined) return parseAny(tv, depth + 1);
    }
    return 0;
  };

  return parseAny(v0);
}

function isRowAllZero(r: any): boolean {
  if (!r) return true;
  const reach = toFiniteNumber(r?.reach);
  const pv = toFiniteNumber(r?.profileViewsTotal);
  const ti = toFiniteNumber(r?.totalInteractions);
  return reach === 0 && pv === 0 && ti === 0;
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
  followers: number;
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
    `?metric=reach,follower_count` +
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
    const rA = await axios.get(insightsUrlA, { timeout: 15000 });
    insightsA = rA.data as IgInsightsResponse;
  } catch (e: any) {
    const graphError = e?.response?.data?.error;
    const msg = String(graphError?.message ?? e?.message ?? "Erro Graph A");
    throw new Error(`Graph /insights(A) falhou (${day}): ${msg}`);
  }

  try {
    const rB = await axios.get(insightsUrlB, { timeout: 15000 });
    insightsB = rB.data as IgInsightsResponse;
  } catch {
    insightsB = { data: [] };
  }

  const rowsA = insightsA?.data ?? [];
  if (!Array.isArray(rowsA) || rowsA.length === 0) {
    throw new Error(`Graph /insights(A) veio vazio (${day}).`);
  }

  const reach = toFiniteNumber(pickInsightValueByMetric(insightsA, "reach"));
  let followers = toFiniteNumber(
    pickInsightValueByMetric(insightsA, "follower_count")
  );

  const profileViews = toFiniteNumber(
    pickInsightValueByMetric(insightsB, "profile_views")
  );
  const totalInteractions = toFiniteNumber(
    pickInsightValueByMetric(insightsB, "total_interactions")
  );

  if (!followers) {
    const meUrl =
      `${base}` +
      `?fields=followers_count` +
      `&access_token=${encodeURIComponent(token)}`;
    try {
      const me = await axios.get(meUrl, { timeout: 15000 });
      followers = toFiniteNumber((me.data as any)?.followers_count);
    } catch {
      followers = 0;
    }
  }

  return { reach, profileViews, followers, totalInteractions };
}

/* =========================
   Types
========================= */

export type RunInstagramBackfillParams = {
  userId: string;
  instagramAccountId?: string | null; // se não vier, pega active ou primeira conectada
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  force?: boolean;       // se true, refaz todos os dias do range
  refillZeros?: boolean; // se true, refaz dias zerados
  alwaysRefetchLastDays?: number; // default 7
  concurrency?: number;  // default 2
};

export type RunInstagramBackfillResult = {
  ok: true;
  instagramAccountIdUsed: string;
  range: { from: string; to: string; days: number };
  plannedDays: number;
  fetchedDays: number;
  errorsCount: number;
  errorsPreview: Array<{ day: string; message: string }>;
};

export class RunInstagramBackfillUseCase {
  async execute(params: RunInstagramBackfillParams): Promise<RunInstagramBackfillResult> {
    const userId = s(params.userId);
    const from = s(params.from).slice(0, 10);
    const to = s(params.to).slice(0, 10);

    if (!userId) throw new Error("userId é obrigatório");
    if (!from || !to || from > to) throw new Error("Range inválido");

    const { days, from: safeFrom, to: safeTo } = clampRangeDays(from, to, 92);

    const alwaysRefetchLastDays = Math.max(
      0,
      Number(params.alwaysRefetchLastDays ?? 7) || 7
    );
    const concurrency = Math.max(1, Number(params.concurrency ?? 2) || 2);

    const lastDaysSet = new Set(
      days.slice(Math.max(0, days.length - alwaysRefetchLastDays))
    );

    // resolve account
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeInstagramAccountId: true },
    });

    const desiredAccountId = s(params.instagramAccountId ?? "") || s(user?.activeInstagramAccountId ?? "");

    const account =
      (desiredAccountId
        ? await prisma.instagramAccount.findFirst({
            where: { id: desiredAccountId, userId, isConnected: true },
            orderBy: { updatedAt: "desc" },
          })
        : null) ||
      (await prisma.instagramAccount.findFirst({
        where: { userId, isConnected: true },
        orderBy: { updatedAt: "desc" },
      }));

    if (!account) throw new Error("Conta do Instagram não encontrada");

    const instagramAccountIdUsed = account.id;
    const igUserId = s((account as any)?.igUserId);
    const pageAccessToken = s((account as any)?.pageAccessToken);

    if (!igUserId || !pageAccessToken) {
      throw new Error("Conta IG sem igUserId/pageAccessToken. Refaça a conexão.");
    }

    const force = !!params.force;
    const refillZeros = params.refillZeros ?? true;

    // load existing
    const existing = await prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId,
        instagramAccountId: instagramAccountIdUsed,
        day: {
          gte: dateOnlyUtcFromYmd(safeFrom),
          lte: dateOnlyUtcFromYmd(safeTo),
        },
      },
      orderBy: { day: "asc" },
    });

    const byDayExisting = new Map<string, any>();
    for (const r of existing) byDayExisting.set(ymd(r.day), r);

    const daysToFetch = force
      ? [...days]
      : days.filter((d) => {
          const r = byDayExisting.get(d);
          if (!r) return true;
          if (lastDaysSet.has(d)) return true;
          if (!refillZeros) return false;
          return isRowAllZero(r);
        });

    const errors: Array<{ day: string; message: string }> = [];
    let fetchedDays = 0;

    await runPromisePool(daysToFetch, concurrency, async (dayYmd) => {
      try {
        const g = await fetchDailyInsightsFromGraph({
          igUserId,
          pageAccessToken,
          dayYmd,
        });

        await prisma.instagramAccountDailyMetrics.upsert({
          where: {
            instagramAccountId_day: {
              instagramAccountId: instagramAccountIdUsed,
              day: dateOnlyUtcFromYmd(dayYmd),
            },
          },
          create: {
            userId,
            instagramAccountId: instagramAccountIdUsed,
            day: dateOnlyUtcFromYmd(dayYmd),
            followers: toFiniteNumber(g.followers),
            profileViewsTotal: toFiniteNumber(g.profileViews),
            reach: toFiniteNumber(g.reach),
            totalInteractions: toFiniteNumber(g.totalInteractions),
          },
          update: {
            followers: toFiniteNumber(g.followers),
            profileViewsTotal: toFiniteNumber(g.profileViews),
            reach: toFiniteNumber(g.reach),
            totalInteractions: toFiniteNumber(g.totalInteractions),
          },
        });

        fetchedDays++;
      } catch (e: any) {
        errors.push({ day: dayYmd, message: String(e?.message ?? "erro") });
      }
    });

    return {
      ok: true,
      instagramAccountIdUsed,
      range: { from: safeFrom, to: safeTo, days: days.length },
      plannedDays: daysToFetch.length,
      fetchedDays,
      errorsCount: errors.length,
      errorsPreview: errors.slice(0, 10),
    };
  }
}
