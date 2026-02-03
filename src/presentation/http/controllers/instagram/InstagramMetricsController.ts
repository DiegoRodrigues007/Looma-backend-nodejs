import { Request, Response } from "express";
import { prisma } from "../../../../infrastructure/db/prismaClient";

import { s, getAuthenticatedUserId } from "./helpers/auth";
import { safeJson } from "./helpers/http";
import { parseBool } from "./helpers/parse";
import {
  clampRangeDays,
  dateOnlyUtcFromYmd,
  addDaysYmd,
} from "./helpers/dates";

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
      (req.query as Record<string, unknown>)?.instagramAccountId,
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

    const force = parseBool((req.query as Record<string, unknown>)?.force) ?? false;
    const refillZeros =
      parseBool((req.query as Record<string, unknown>)?.refillZeros) ?? true;

    const ALWAYS_REFETCH_LAST_DAYS = 7;
    const lastDaysSet = new Set(
      days.slice(Math.max(0, days.length - ALWAYS_REFETCH_LAST_DAYS)),
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
    for (const r of existing) byDayExisting.set(r.day.toISOString().slice(0, 10), r);

    const missingDays = days.filter((d) => !byDayExisting.get(d));
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

    const timeseries: InstagramTimeseriesPoint[] = days.map((day) => {
      const r = byDayExisting.get(day);

      const followers = 0;
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

    const totalReach = timeseries.reduce(
      (a, b) => a + toFiniteNumber(b.reach),
      0,
    );

    const totalInteractions = timeseries.reduce(
      (a, b) => a + toFiniteNumber(b.totalInteractions),
      0,
    );

    const avgEngagementRate =
      timeseries.reduce((a, b) => a + toFiniteNumber(b.engagementRate), 0) /
      Math.max(1, timeseries.length);

    const summary = buildWindowsSummary(timeseries);

    return safeJson(res, 200, {
      ok: true,
      requestedInstagramAccountId: requestedInstagramAccountId || null,
      activeInstagramAccountId: user?.activeInstagramAccountId ?? null,
      instagramAccountIdUsed: account.id,
      filters: { from: safeFrom, to: safeTo },
      kpis: {
        reach: totalReach,
        totalInteractions,
        engagementRate: avgEngagementRate,
      },
      timeseries,
      summary,
      meta: {
        source: "instagram_account_daily_metrics",
        generatedBy: "database",
        missingDaysCount: missingDays.length,
        zeroDaysCount: zeroDays.length,
        suggestedFetchDaysCount: suggestedFetchDays.length,
        suggestedFetchDaysPreview: suggestedFetchDays.slice(0, 10),
        params: {
          force,
          refillZeros,
          alwaysRefetchLastDays: ALWAYS_REFETCH_LAST_DAYS,
        },
      },
    });
  }
}
