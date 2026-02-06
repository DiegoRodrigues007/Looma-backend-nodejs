import { Request, Response } from "express";
import { prisma } from "../../../../infrastructure/db/prismaClient";

import { s, getAuthenticatedUserId } from "./helpers/auth";
import { safeJson } from "./helpers/http";
import { parseBool } from "./helpers/parse";
import { clampRangeDays, dateOnlyUtcFromYmd } from "./helpers/dates";

import {
  buildWindowsSummary,
  InstagramTimeseriesPoint,
} from "../../../../domain/metrics/windows/metricsWindows";
import { toFiniteNumber } from "../../../../domain/metrics/instagram/instagramInsightsMapper";

type DailyRowLike = {
  reach?: unknown;
  profileViewsTotal?: unknown;
  totalInteractions?: unknown;
  followers?: unknown;
};

function isRowAllZero(r: DailyRowLike | null | undefined): boolean {
  if (!r) return true;
  const reach = toFiniteNumber(r?.reach);
  const pv = toFiniteNumber(r?.profileViewsTotal);
  const ti = toFiniteNumber(r?.totalInteractions);
  return reach === 0 && pv === 0 && ti === 0;
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pickLastKnownFollowers(
  days: string[],
  byDayExisting: Map<string, any>
): { value: number | null; day: string | null } {
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    const r = byDayExisting.get(day);
    if (!r) continue;
    const v = toFiniteNumber(r?.followers);
    // Se existe row, consideramos "conhecido" (mesmo 0). 0 pode disparar backfill via zeroDays.
    return { value: Number.isFinite(v) ? v : null, day };
  }
  return { value: null, day: null };
}

function pickFirstKnownFollowers(
  days: string[],
  byDayExisting: Map<string, any>
): { value: number | null; day: string | null } {
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const r = byDayExisting.get(day);
    if (!r) continue;
    const v = toFiniteNumber(r?.followers);
    return { value: Number.isFinite(v) ? v : null, day };
  }
  return { value: null, day: null };
}

type BackfillInfo = {
  created: boolean;
  jobId: string | null;
  mode: "db" | "skip";
};

/**
 * ✅ Cria jobs de backfill para um range.
 * - Mantém idempotência: evita duplicar (cria só se não existir um job queued/running pro mesmo range)
 */
async function ensureBackfillJob(opts: {
  userId: string;
  instagramAccountId: string;
  from: string;
  to: string;
  force?: boolean;
  refillZeros?: boolean;
}): Promise<BackfillInfo> {
  const { userId, instagramAccountId, from, to, force, refillZeros } = opts;

  try {
    const existing = await (prisma as any).instagramBackfillJob.findFirst({
      where: {
        userId,
        instagramAccountId,
        from,
        to,
        status: { in: ["queued", "running"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (existing?.id) {
      return { created: false, jobId: String(existing.id), mode: "skip" };
    }

    const created = await (prisma as any).instagramBackfillJob.create({
      data: {
        userId,
        instagramAccountId,
        from,
        to,
        status: "queued",
        force: !!force,
        refillZeros: !!refillZeros,
      },
      select: { id: true },
    });

    return { created: true, jobId: String(created?.id ?? null), mode: "db" };
  } catch {
    return { created: false, jobId: null, mode: "skip" };
  }
}

type TimeseriesPointWithStatus = {
  date: string;
  followers: number | null;
  reach: number | null;
  profileViews: number | null;
  totalInteractions: number | null;
  engagementRate: number | null;

  // 👇 auxiliares pra UI/IA (sem misturar string no campo numérico)
  status: "ok" | "no_data";
  note?: string; // ex: "Sem coleta neste dia"
};

export class InstagramMetricsController {
  async metrics(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return safeJson(res, 401, { ok: false, message: "Não autenticado" });
    }

    const from = String(req.query.from ?? "").slice(0, 10);
    const to = String(req.query.to ?? "").slice(0, 10);

    if (!from || !to || from > to) {
      return safeJson(res, 400, { ok: false, message: "Range inválido" });
    }

    const { days, from: safeFrom, to: safeTo } = clampRangeDays(from, to, 92);

    const requestedInstagramAccountId = s(
      (req.query as Record<string, unknown>)?.instagramAccountId
    );

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { activeInstagramAccountId: true },
    });

    const accountByRequest = requestedInstagramAccountId
      ? await prisma.instagramAccount.findFirst({
          where: {
            id: requestedInstagramAccountId,
            userId: s(userId),
            isConnected: true,
          },
          orderBy: { updatedAt: "desc" },
        })
      : null;

    const accountByActive =
      user?.activeInstagramAccountId && !accountByRequest
        ? await prisma.instagramAccount.findFirst({
            where: {
              id: user.activeInstagramAccountId,
              userId: s(userId),
              isConnected: true,
            },
            orderBy: { updatedAt: "desc" },
          })
        : null;

    const accountByLatest =
      !accountByRequest && !accountByActive
        ? await prisma.instagramAccount.findFirst({
            where: { userId: s(userId), isConnected: true },
            orderBy: { updatedAt: "desc" },
          })
        : null;

    const account = accountByRequest || accountByActive || accountByLatest;

    if (!account) {
      return safeJson(res, 404, {
        ok: false,
        message: "Conta do Instagram não encontrada",
      });
    }

    const force =
      parseBool((req.query as Record<string, unknown>)?.force) ?? false;
    const refillZeros =
      parseBool((req.query as Record<string, unknown>)?.refillZeros) ?? true;

    const ALWAYS_REFETCH_LAST_DAYS = 7;
    const lastDaysSet = new Set(
      days.slice(Math.max(0, days.length - ALWAYS_REFETCH_LAST_DAYS))
    );

    const existing = await prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId: s(userId),
        instagramAccountId: account.id,
        day: {
          gte: dateOnlyUtcFromYmd(safeFrom),
          lte: dateOnlyUtcFromYmd(safeTo),
        },
      },
      orderBy: { day: "asc" },
    });

    const byDayExisting = new Map<string, (typeof existing)[number]>();
    for (const r of existing) byDayExisting.set(toYmd(r.day), r);

    // ✅ “missing” é realmente “não tem registro” (melhor do que inventar 0)
    const missingDays = days.filter((d) => !byDayExisting.get(d));

    // ✅ “zeroDays” são dias com row existente, mas métricas zeradas (suspeito / precisa refill)
    const zeroDays = days.filter((d) => {
      const r = byDayExisting.get(d);
      if (!r) return false;
      if (!refillZeros) return false;
      if (lastDaysSet.has(d)) return true;
      return isRowAllZero(r);
    });

    const suggestedFetchDays = force
      ? [...days]
      : Array.from(new Set([...missingDays, ...zeroDays]));

    /**
     * ✅ DISPARA BACKFILL AUTOMÁTICO (quando precisa)
     * - Continua como está: cria 1 job pro range inteiro.
     */
    let backfill: BackfillInfo = { created: false, jobId: null, mode: "skip" };
    if (suggestedFetchDays.length > 0) {
      backfill = await ensureBackfillJob({
        userId: s(userId),
        instagramAccountId: account.id,
        from: safeFrom,
        to: safeTo,
        force,
        refillZeros,
      });
    }

    /**
     * ✅ CORREÇÃO PRINCIPAL:
     * - NÃO “carrega 0” (carry forward) quando não existe row no banco.
     * - Se não tem registro no dia => followers/reach/etc = null e status = "no_data"
     * - Isso evita picos falsos no frontend.
     */
    const timeseries: TimeseriesPointWithStatus[] = days.map((day) => {
      const r = byDayExisting.get(day);

      if (!r) {
        return {
          date: day,
          followers: null,
          reach: null,
          profileViews: null,
          totalInteractions: null,
          engagementRate: null,
          status: "no_data",
          // ✅ do jeito que você quer (mensagem), mas sem quebrar o tipo numérico:
          note: "Sem coleta neste dia",
        };
      }

      const followers = toFiniteNumber(r?.followers);
      const reach = toFiniteNumber(r?.reach);
      const profileViews = toFiniteNumber(r?.profileViewsTotal);
      const totalInteractions = toFiniteNumber(r?.totalInteractions);

      const engagementRate =
        reach > 0 ? (totalInteractions / reach) * 100 : 0;

      return {
        date: day,
        followers: Number.isFinite(followers) ? followers : null,
        reach: Number.isFinite(reach) ? reach : null,
        profileViews: Number.isFinite(profileViews) ? profileViews : null,
        totalInteractions: Number.isFinite(totalInteractions)
          ? totalInteractions
          : null,
        engagementRate: Number.isFinite(engagementRate) ? engagementRate : null,
        status: "ok",
      };
    });

    // ✅ KPIs “best effort” usando o ÚLTIMO/PRIMEIRO DIA COM REGISTRO (não inventa)
    const lastFollowers = pickLastKnownFollowers(days, byDayExisting);
    const firstFollowers = pickFirstKnownFollowers(days, byDayExisting);

    const followersDelta =
      lastFollowers.value !== null && firstFollowers.value !== null
        ? toFiniteNumber(lastFollowers.value) - toFiniteNumber(firstFollowers.value)
        : null;

    // ✅ Totais/medias apenas do que existe (não soma null)
    const totalReach = timeseries.reduce(
      (acc, p) => acc + (p.reach ?? 0),
      0
    );

    const totalInteractions = timeseries.reduce(
      (acc, p) => acc + (p.totalInteractions ?? 0),
      0
    );

    const engagementRates = timeseries
      .map((p) => p.engagementRate)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const avgEngagementRate =
      engagementRates.reduce((a, b) => a + b, 0) /
      Math.max(1, engagementRates.length);

    /**
     * ✅ Summary: para não distorcer janelas, geramos summary APENAS com pontos válidos.
     * Se não houver pontos válidos suficientes, summary fica vazio.
     */
    const timeseriesForSummary: InstagramTimeseriesPoint[] = timeseries
      .filter(
        (p) =>
          p.status === "ok" &&
          p.followers !== null &&
          p.reach !== null &&
          p.profileViews !== null &&
          p.totalInteractions !== null &&
          p.engagementRate !== null
      )
      .map((p) => ({
        date: p.date,
        followers: p.followers as number,
        reach: p.reach as number,
        profileViews: p.profileViews as number,
        totalInteractions: p.totalInteractions as number,
        engagementRate: p.engagementRate as number,
      }));

    const summary =
      timeseriesForSummary.length > 0
        ? buildWindowsSummary(timeseriesForSummary)
        : null;

    const dataQuality =
      missingDays.length === 0 && zeroDays.length === 0 ? "complete" : "partial";

    return safeJson(res, 200, {
      ok: true,
      requestedInstagramAccountId: requestedInstagramAccountId || null,
      activeInstagramAccountId: user?.activeInstagramAccountId ?? null,
      instagramAccountIdUsed: account.id,
      filters: { from: safeFrom, to: safeTo },

      // ✅ KPIs agora respeitam “partial”
      kpis: {
        followers: lastFollowers.value,
        followersDelta,
        reach: totalReach,
        totalInteractions,
        engagementRate: avgEngagementRate,
      },

      // ✅ timeseries com null + status/note (forma mais correta)
      timeseries,

      // ✅ summary baseado só em pontos válidos
      summary,

      meta: {
        source: "instagram_account_daily_metrics",
        generatedBy: "database",
        dataQuality,
        coverage: {
          totalDays: days.length,
          availableDays: days.length - missingDays.length,
          missingDays: missingDays.length,
          zeroDays: zeroDays.length,
        },
        missingDaysCount: missingDays.length,
        zeroDaysCount: zeroDays.length,
        suggestedFetchDaysCount: suggestedFetchDays.length,
        suggestedFetchDaysPreview: suggestedFetchDays.slice(0, 10),
        backfill: {
          attempted: suggestedFetchDays.length > 0,
          created: backfill.created,
          jobId: backfill.jobId,
          mode: backfill.mode,
        },
        params: {
          force,
          refillZeros,
          alwaysRefetchLastDays: ALWAYS_REFETCH_LAST_DAYS,
        },
        followersMeta: {
          firstKnown: firstFollowers,
          lastKnown: lastFollowers,
        },
      },
    });
  }
}
