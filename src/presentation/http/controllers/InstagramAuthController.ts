import { Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { IInstagramIgLoginAuthService } from "../../../application/ports/instagram/IInstagramIgLoginAuthService";
import { CompleteIgLoginUseCase } from "../../../application/use-cases/instagram/CompleteIgLoginUseCase";
import { ListInstagramAccountsUseCase } from "../../../application/use-cases/instagram/ListInstagramAccountsUseCase";
import { SetActiveInstagramAccountUseCase } from "../../../application/use-cases/instagram/SetActiveInstagramAccountUseCase";
import { ymd, listDays } from "../../../shared/date/instagramDateUtils";
import { toFiniteNumber } from "../../../domain/metrics/instagram/instagramInsightsMapper";
import {
  setIgLoginCookie,
  getIgLoginCookie,
  clearIgLoginCookie,
} from "../instagram/instagramCookies";
import { signState, safeParseState } from "../instagram/instagramState";
import { GetInstagramDashboardMetricsUseCase } from "../../../application/use-cases/instagram/GetInstagramDashboardMetricsUseCase";
import {
  buildWindowsSummary,
  type InstagramTimeseriesPoint,
} from "../../../domain/metrics/windows/metricsWindows";

const ENABLE_INPROCESS_BACKFILL = String(process.env.ENABLE_INPROCESS_BACKFILL ?? "").toLowerCase() === "true";
const INPROCESS_BACKFILL_CONCURRENCY = Math.max(1, Number(process.env.INPROCESS_BACKFILL_CONCURRENCY ?? 2) || 2);

function s(v: any): string {
  return String(v ?? "").trim();
}

function getAuthenticatedUserId(req: Request): string | null {
  const anyReq = req as any;
  const v =
    anyReq?.user?.sub ||
    anyReq?.user?.id ||
    anyReq?.user?.userId ||
    anyReq?.userId ||
    req.header("x-user-id") ||
    null;

  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function safeJson(res: Response, status: number, body: any) {
  if (!res.headersSent) return res.status(status).json(body);
  return undefined;
}

function safeRedirect(res: Response, status: number, url: string) {
  if (!res.headersSent) return res.redirect(status, url);
  return undefined;
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

function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  const ss = String(value).toLowerCase();
  if (ss === "true" || ss === "1") return true;
  if (ss === "false" || ss === "0") return false;
  return undefined;
}

function candidatesOrderBy() {
  return [{ selectedAt: "desc" as const }, { createdAt: "desc" as const }];
}

type IgInsightsResponse = {
  data?: Array<{
    name?: string;
    period?: string;
    values?: Array<{ value?: any; end_time?: string }>;
    title?: string;
    description?: string;
    id?: string;
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
  const runners = new Array(Math.min(concurrency, queue.length)).fill(null).map(async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      await worker(item);
    }
  });
  await Promise.allSettled(runners);
}

function triggerInProcessBackfill(params: {
  userId: string;
  instagramAccountId: string;
  igUserId: string;
  pageAccessToken: string;
  daysToFetch: string[];
  refillZeros: boolean;
}) {
  if (!ENABLE_INPROCESS_BACKFILL) return;

  setImmediate(async () => {
    const { userId, instagramAccountId, igUserId, pageAccessToken, daysToFetch } = params;

    await runPromisePool(daysToFetch, INPROCESS_BACKFILL_CONCURRENCY, async (dayYmd) => {
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
      } catch {
        // aqui pode logar se quiser (mas não quebra o endpoint)
      }
    });
  });
}

export class InstagramAuthController {
  constructor(
    private readonly authService: IInstagramIgLoginAuthService,
    private readonly completeLogin: CompleteIgLoginUseCase,
    private readonly listAccounts: ListInstagramAccountsUseCase,
    private readonly setActiveAccount: SetActiveInstagramAccountUseCase,
    private readonly dashboardMetrics: GetInstagramDashboardMetricsUseCase
  ) {}

  async start(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    const rawState = JSON.stringify({
      uid: userId,
      nonce: crypto.randomBytes(12).toString("hex"),
      ts: Date.now(),
    });

    const signedState = signState(rawState);
    setIgLoginCookie(res, userId);

    const url = this.authService.buildLoginUrl(signedState, false);

    const redirect = parseBool((req.query as any)?.redirect);
    if (redirect) return safeRedirect(res, 302, url);

    return safeJson(res, 200, { ok: true, url });
  }

  async callback(req: Request, res: Response) {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");

    if (!code) return safeJson(res, 400, { ok: false, message: "code é obrigatório" });

    let userId = getIgLoginCookie(req);
    if (state) {
      const parsed = safeParseState(state);
      if (!userId && parsed?.uid) userId = parsed.uid;
    }

    if (!userId) {
      clearIgLoginCookie(res);
      return safeJson(res, 401, { ok: false, message: "Sessão expirada" });
    }

    try {
      const result = await this.completeLogin.execute(code, state, userId);

      if ((result as any)?.status === "reauth_required") {
        clearIgLoginCookie(res);
        return safeJson(res, 200, { ok: true, ...result });
      }

      if ((result as any)?.status === "choose_required") {
        const selectionId = s((result as any)?.selectionId);

        try {
          const candidatesForDb = await this.completeLogin.getCandidatesForDb({
            selectionId,
            userId: s(userId),
          });

          const data = candidatesForDb
            .map((c) => ({
              userId: s(userId),
              selectionId,
              igUserId: s(c.igUserId),
              username: c.username ? s(c.username) : null,
              accountType: c.accountType ? s(c.accountType) : null,
              facebookPageId: s(c.facebookPageId),
              facebookPageName: c.facebookPageName ? s(c.facebookPageName) : null,
              pageAccessToken: s(c.pageAccessToken),
              source: s(c.source),
              instagramAccountId: null,
            }))
            .filter((c) => c.igUserId && c.facebookPageId && c.pageAccessToken && c.source);

          await prisma.instagramCandidate.deleteMany({
            where: { userId: s(userId), selectionId },
          });

          if (data.length > 0) {
            await prisma.instagramCandidate.createMany({
              data,
              skipDuplicates: true,
            });
          }
        } catch {
          // silencioso (não loga)
        }

        clearIgLoginCookie(res);
        return safeJson(res, 200, { ok: true, ...result });
      }

      clearIgLoginCookie(res);
      return safeJson(res, 200, { ok: true, status: "ok" });
    } catch (e: any) {
      clearIgLoginCookie(res);
      return safeJson(res, 500, { ok: false, message: e?.message ?? "Erro no login IG" });
    }
  }

  async candidates(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    let selectionId = s((req.query as any)?.selectionId);

    if (!selectionId) {
      const last = await prisma.instagramCandidate.findFirst({
        where: { userId: s(userId) },
        orderBy: candidatesOrderBy(),
        select: { selectionId: true },
      });
      selectionId = s(last?.selectionId);
    }

    const where: any = { userId: s(userId) };
    if (selectionId) where.selectionId = selectionId;

    const rows = await prisma.instagramCandidate.findMany({
      where,
      orderBy: candidatesOrderBy(),
      take: 50,
    });

    return safeJson(res, 200, {
      ok: true,
      selectionId: selectionId || null,
      total: rows.length,
      candidates: rows,
    });
  }

  async status(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { id: true, activeInstagramAccountId: true },
    });

    const accounts = await prisma.instagramAccount.findMany({
      where: {
        userId: s(userId),
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        expiresAt: true,
        isConnected: true,
        updatedAt: true,
      },
      take: 50,
    });

    let activeId = user?.activeInstagramAccountId ?? null;
    let active = activeId ? accounts.find((a) => a.id === activeId) ?? null : null;

    if ((!activeId || !active) && accounts.length > 0) {
      active = accounts[0];
      activeId = active.id;
      try {
        await prisma.user.update({
          where: { id: s(userId) },
          data: { activeInstagramAccountId: activeId },
        });
      } catch {
        // silencioso
      }
    }

    return safeJson(res, 200, {
      ok: true,
      connected: accounts.length > 0,
      totalAccounts: accounts.length,
      activeInstagramAccountId: activeId,
      account: active
        ? {
            id: active.id,
            igUserId: active.igUserId,
            username: active.username ?? null,
            accountType: active.accountType ?? null,
            facebookPageId: active.facebookPageId ?? null,
            expiresAt: active.expiresAt ?? null,
            isConnected: active.isConnected,
            updatedAt: active.updatedAt,
          }
        : null,
    });
  }

  async accounts(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    if (this.listAccounts && typeof (this.listAccounts as any).execute === "function") {
      const out = await (this.listAccounts as any).execute(s(userId));
      return safeJson(res, 200, { ok: true, ...out });
    }

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { activeInstagramAccountId: true },
    });

    const rows = await prisma.instagramAccount.findMany({
      where: {
        userId: s(userId),
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        expiresAt: true,
        isConnected: true,
        updatedAt: true,
      },
      take: 50,
    });

    let activeId = user?.activeInstagramAccountId ?? null;
    const activeExists = activeId ? rows.some((r) => r.id === activeId) : false;

    if ((!activeId || !activeExists) && rows.length > 0) {
      activeId = rows[0].id;
      try {
        await prisma.user.update({
          where: { id: s(userId) },
          data: { activeInstagramAccountId: activeId },
        });
      } catch {
        // silencioso
      }
    }

    return safeJson(res, 200, {
      ok: true,
      activeInstagramAccountId: activeId,
      total: rows.length,
      accounts: rows.map((r) => ({
        id: r.id,
        igUserId: r.igUserId,
        username: r.username ?? null,
        accountType: r.accountType ?? null,
        facebookPageId: r.facebookPageId ?? null,
        expiresAt: r.expiresAt ?? null,
        isConnected: r.isConnected,
        updatedAt: r.updatedAt,
        isActive: activeId ? r.id === activeId : false,
      })),
    });
  }

  async setActive(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    const instagramAccountId = s((req.body as any)?.instagramAccountId);
    if (!instagramAccountId) {
      return safeJson(res, 400, { ok: false, message: "instagramAccountId é obrigatório" });
    }

    if (this.setActiveAccount && typeof (this.setActiveAccount as any).execute === "function") {
      const out = await (this.setActiveAccount as any).execute(s(userId), instagramAccountId);
      return safeJson(res, 200, { ok: true, ...out });
    }

    const exists = await prisma.instagramAccount.findFirst({
      where: {
        id: instagramAccountId,
        userId: s(userId),
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      select: {
        id: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        updatedAt: true,
      },
    });

    if (!exists) {
      return safeJson(res, 404, {
        ok: false,
        message: "Conta Instagram não encontrada para este usuário (ou não está conectada).",
      });
    }

    await prisma.user.update({
      where: { id: s(userId) },
      data: { activeInstagramAccountId: exists.id },
    });

    return safeJson(res, 200, {
      ok: true,
      activeInstagramAccountId: exists.id,
      account: {
        id: exists.id,
        igUserId: exists.igUserId,
        username: exists.username ?? null,
        accountType: exists.accountType ?? null,
        facebookPageId: exists.facebookPageId ?? null,
        updatedAt: exists.updatedAt,
      },
    });
  }

  async metrics(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    const from = String(req.query.from ?? "").slice(0, 10);
    const to = String(req.query.to ?? "").slice(0, 10);

    if (!from || !to || from > to) {
      return safeJson(res, 400, { ok: false, message: "Range inválido" });
    }

    const { days, from: safeFrom, to: safeTo } = clampRangeDays(from, to, 92);

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { activeInstagramAccountId: true },
    });

    const account =
      (user?.activeInstagramAccountId
        ? await prisma.instagramAccount.findFirst({
            where: {
              id: user.activeInstagramAccountId,
              userId: s(userId),
              isConnected: true,
            },
            orderBy: { updatedAt: "desc" },
          })
        : null) ||
      (await prisma.instagramAccount.findFirst({
        where: { userId: s(userId), isConnected: true },
        orderBy: { updatedAt: "desc" },
      }));

    if (!account) {
      return safeJson(res, 404, { ok: false, message: "Conta do Instagram não encontrada" });
    }

    const pageAccessToken = s((account as any)?.pageAccessToken);
    const igUserId = s((account as any)?.igUserId);
    const hasGraphCreds = !!pageAccessToken && !!igUserId;

    const force = parseBool((req.query as any)?.force) ?? false;
    const refillZeros = parseBool((req.query as any)?.refillZeros) ?? true;

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

    const byDayExisting = new Map<string, any>();
    for (const r of existing) byDayExisting.set(ymd(r.day), r);

    const missingDays = days.filter((d) => !byDayExisting.get(d));
    const zeroDays = days.filter((d) => {
      const r = byDayExisting.get(d);
      if (!r) return false;
      if (!refillZeros) return false;
      if (lastDaysSet.has(d)) return true; 
      return isRowAllZero(r);
    });

    const suggestedFetchDays = force ? [...days] : Array.from(new Set([...missingDays, ...zeroDays]));

    const timeseries: InstagramTimeseriesPoint[] = days.map((day) => {
      const r = byDayExisting.get(day);
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

    const totalReach = timeseries.reduce((a, b) => a + toFiniteNumber(b.reach), 0);
    const totalInteractions = timeseries.reduce(
      (a, b) => a + toFiniteNumber(b.totalInteractions),
      0
    );

    const avgEngagementRate =
      timeseries.reduce((a, b) => a + toFiniteNumber(b.engagementRate), 0) /
      Math.max(1, timeseries.length);

    const followers =
      timeseries.length > 0
        ? toFiniteNumber(timeseries[timeseries.length - 1].followers)
        : 0;

    const allZero =
      timeseries.length > 0 &&
      timeseries.every(
        (x) =>
          toFiniteNumber(x.reach) === 0 &&
          toFiniteNumber(x.profileViews) === 0 &&
          toFiniteNumber(x.totalInteractions) === 0
      );

    const summary = buildWindowsSummary(timeseries);

    const shouldAutoBackfill =
      parseBool((req.query as any)?.autoBackfill) ?? false; 

    if (shouldAutoBackfill && hasGraphCreds && suggestedFetchDays.length > 0) {
      triggerInProcessBackfill({
        userId: s(userId),
        instagramAccountId: account.id,
        igUserId,
        pageAccessToken,
        daysToFetch: suggestedFetchDays,
        refillZeros,
      });
    }

    return safeJson(res, 200, {
      ok: true,
      activeInstagramAccountId: user?.activeInstagramAccountId ?? null,
      instagramAccountIdUsed: account.id,
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
        source: "instagram_account_daily_metrics",
        generatedBy: "database",
        hasGraphCreds,
        allZero,
        hint: allZero ? "Tudo zerado (provável falta de histórico no banco)." : "OK",

        missingDaysCount: missingDays.length,
        zeroDaysCount: zeroDays.length,
        suggestedFetchDaysCount: suggestedFetchDays.length,
        suggestedFetchDaysPreview: suggestedFetchDays.slice(0, 10),

        params: {
          force,
          refillZeros,
          alwaysRefetchLastDays: ALWAYS_REFETCH_LAST_DAYS,
          autoBackfill: shouldAutoBackfill,
          enableInprocessBackfill: ENABLE_INPROCESS_BACKFILL,
          inprocessConcurrency: INPROCESS_BACKFILL_CONCURRENCY,
        },
      },
    });
  }
}
