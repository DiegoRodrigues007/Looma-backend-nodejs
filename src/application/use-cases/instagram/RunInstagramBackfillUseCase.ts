// src/application/use-cases/instagram/RunInstagramBackfillUseCase.ts
import axios from "axios";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { listDays, ymd } from "../../../shared/date/instagramDateUtils";
import { toFiniteNumber } from "../../../domain/metrics/instagram/instagramInsightsMapper";
import { MetricsPlatform, type InstagramAccountDailyMetrics } from "@prisma/client";

function s(v: unknown): string {
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

      if ("total_value" in obj) return parseAny(obj.total_value, depth + 1);
      if ("value" in obj) return parseAny(obj.value, depth + 1);

      const tv = (obj as any)?.total_value?.value;
      if (tv !== undefined) return parseAny(tv, depth + 1);
    }

    return 0;
  };

  return parseAny(v0);
}

function isRowAllZero(r: InstagramAccountDailyMetrics | null | undefined): boolean {
  if (!r) return true;
  const reach = toFiniteNumber(r.reach);
  const pv = toFiniteNumber(r.profileViewsTotal);
  const ti = toFiniteNumber(r.totalInteractions);
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

/**
 * ✅ Agora esse fetch NÃO busca follower_count no insights (isso bagunça).
 * Ele só busca métricas diárias (reach/profile_views/total_interactions).
 */
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

  // ✅ reach por dia
  const insightsUrlA =
    `${base}/insights` +
    `?metric=reach` +
    `&period=day` +
    `&since=${sinceTs}` +
    `&until=${untilTs}` +
    `&access_token=${encodeURIComponent(token)}`;

  // ✅ profile_views + total_interactions (total_value)
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
  const profileViews = toFiniteNumber(
    pickInsightValueByMetric(insightsB, "profile_views")
  );
  const totalInteractions = toFiniteNumber(
    pickInsightValueByMetric(insightsB, "total_interactions")
  );

  return { reach, profileViews, totalInteractions };
}

/**
 * ✅ Followers TOTAL real (snapshot do "agora")
 * Usa /{igUserId}?fields=followers_count
 */
async function fetchFollowersCountNow(params: {
  igUserId: string;
  pageAccessToken: string;
}): Promise<number> {
  const igUserId = s(params.igUserId);
  const token = s(params.pageAccessToken);

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

/* =========================
   Types
========================= */

export type RunInstagramBackfillParams = {
  userId: string;
  instagramAccountId?: string | null; // se não vier, pega active ou primeira conectada
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  force?: boolean; // se true, refaz todos os dias do range
  refillZeros?: boolean; // se true, refaz dias zerados
  alwaysRefetchLastDays?: number; // default 7
  concurrency?: number; // default 2
};

export type RunInstagramBackfillResult = {
  ok: true;
  instagramAccountIdUsed: string;
  range: { from: string; to: string; days: number };
  plannedDays: number;
  fetchedDays: number;
  errorsCount: number;
  errorsPreview: Array<{ day: string; message: string }>;
  // ✅ extra: snapshot gravado
  followersSnapshot?: { day: string; followers: number };
};

export class RunInstagramBackfillUseCase {
  async execute(
    params: RunInstagramBackfillParams
  ): Promise<RunInstagramBackfillResult> {
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

    const desiredAccountId =
      s(params.instagramAccountId ?? "") || s(user?.activeInstagramAccountId ?? "");

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

    // ✅ sem any
    const igUserId = s(account.igUserId);
    const pageAccessToken = s(account.pageAccessToken);

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

    const byDayExisting = new Map<string, InstagramAccountDailyMetrics>();
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

        // ✅ IMPORTANTÍSSIMO:
        // followers NÃO é salvo aqui mais.
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
            followers: null,
            profileViewsTotal: toFiniteNumber(g.profileViews),
            reach: toFiniteNumber(g.reach),
            totalInteractions: toFiniteNumber(g.totalInteractions),
          },
          update: {
            // mantém followers como null pra não “poluir”
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

    // ✅ Snapshot de followers (TOTAL real) para o dia "safeTo"
    const followersNow = await fetchFollowersCountNow({
      igUserId,
      pageAccessToken,
    });

    const snapshotDate = dateOnlyUtcFromYmd(safeTo);

    await prisma.metricsSnapshot.upsert({
      where: {
        userId_platform_date: {
          userId,
          platform: MetricsPlatform.instagram,
          date: snapshotDate,
        },
      },
      create: {
        userId,
        platform: MetricsPlatform.instagram,
        date: snapshotDate,
        followers: Math.trunc(toFiniteNumber(followersNow)),
        // opcional: você pode preencher esses também se quiser
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      },
      update: {
        followers: Math.trunc(toFiniteNumber(followersNow)),
      },
      select: { followers: true },
    });

    return {
      ok: true,
      instagramAccountIdUsed,
      range: { from: safeFrom, to: safeTo, days: days.length },
      plannedDays: daysToFetch.length,
      fetchedDays,
      errorsCount: errors.length,
      errorsPreview: errors.slice(0, 10),
      followersSnapshot: { day: safeTo, followers: Math.trunc(toFiniteNumber(followersNow)) },
    };
  }
}
