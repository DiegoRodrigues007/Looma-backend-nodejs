import { Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
import type { AxiosError } from "axios";

import { prisma } from "../../../infrastructure/db/prismaClient";
import { IInstagramIgLoginAuthService } from "../../../application/interfaces/instagram/IInstagramIgLoginAuthService";
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

const ENABLE_INPROCESS_BACKFILL =
  String(process.env.ENABLE_INPROCESS_BACKFILL ?? "").toLowerCase() === "true";

const INPROCESS_BACKFILL_CONCURRENCY = Math.max(
  1,
  Number(process.env.INPROCESS_BACKFILL_CONCURRENCY ?? 2) || 2,
);

const FRONT_URL = String(
  process.env.FRONTEND_URL ?? process.env.FRONT_URL ?? "http://localhost:5173",
).replace(/\/$/, "");

const IG_RETURN_PATH = String(process.env.IG_RETURN_PATH ?? "/settings");

const PREFER_DB_BACKFILL =
  String(process.env.PREFER_DB_BACKFILL ?? "true").toLowerCase() === "true";

function s(v: unknown): string {
  return String(v ?? "").trim();
}

// ✅ Normaliza DateTime defensivamente (caso algum legado devolva string)
function safeDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

type AuthUserLike = {
  userId?: unknown;
  id?: unknown;
  sub?: unknown;
};

function getAuthenticatedUserId(req: Request): string | null {
  const anyReq = req as Request & { user?: AuthUserLike; userId?: unknown };

  const v =
    anyReq?.user?.userId ||
    anyReq?.user?.id ||
    anyReq?.user?.sub ||
    anyReq?.userId ||
    req.header("x-user-id") ||
    null;

  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function safeJson(res: Response, status: number, body: unknown) {
  if (!res.headersSent) return res.status(status).json(body);
  return undefined;
}

function safeRedirect(res: Response, status: number, url: string) {
  if (!res.headersSent) return res.redirect(status, url);
  return undefined;
}

function wantsJson(req: Request): boolean {
  const accept = String(req.header("accept") ?? "").toLowerCase();
  const xrw = String(req.header("x-requested-with") ?? "").toLowerCase();
  const qs = String(
    (req.query as Record<string, unknown>)?.format ?? "",
  ).toLowerCase();

  if (qs === "json") return true;
  if (accept.includes("application/json")) return true;
  if (xrw === "xmlhttprequest") return true;
  return false;
}

function buildFrontUrl(params: Record<string, string | undefined | null>) {
  const path = IG_RETURN_PATH.startsWith("/")
    ? IG_RETURN_PATH
    : `/${IG_RETURN_PATH}`;
  const u = new URL(`${FRONT_URL}${path}`);

  for (const [k, v] of Object.entries(params)) {
    const val = s(v);
    if (!val) continue;
    u.searchParams.set(k, val);
  }

  return u.toString();
}

function dateOnlyUtcFromYmd(ymdStr: string): Date {
  return new Date(`${ymdStr.slice(0, 10)}T00:00:00.000Z`);
}

function addDaysYmd(ymdStr: string, deltaDays: number): string {
  const d = dateOnlyUtcFromYmd(ymdStr);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return ymd(d);
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

/* ===========================
   In-process (debug) helpers
=========================== */

type IgInsightsResponse = {
  data?: Array<{
    name?: string;
    period?: string;
    values?: Array<{ value?: unknown; end_time?: string }>;
    title?: string;
    description?: string;
    id?: string;
  }>;
};

function pickInsightValueByMetric(
  insights: IgInsightsResponse | null | undefined,
  metricName: string,
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

      const totalValue = obj.total_value as unknown;
      if (totalValue && typeof totalValue === "object") {
        const tvObj = totalValue as Record<string, unknown>;
        if ("value" in tvObj) return parseAny(tvObj.value, depth + 1);
      }
    }

    return 0;
  };

  return parseAny(v0);
}

type GraphErrorPayload = {
  error?: { message?: string };
};

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

  const base = `https://graph.facebook.com/v21.0/${encodeURIComponent(
    igUserId,
  )}`;

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
    const rA = await axios.get<IgInsightsResponse>(insightsUrlA, {
      timeout: 15000,
    });
    insightsA = rA.data;
  } catch (e) {
    const err = e as AxiosError<GraphErrorPayload>;
    const msg = String(
      err.response?.data?.error?.message ?? err.message ?? "Erro Graph A",
    );
    throw new Error(`Graph /insights(A) falhou (${day}): ${msg}`);
  }

  try {
    const rB = await axios.get<IgInsightsResponse>(insightsUrlB, {
      timeout: 15000,
    });
    insightsB = rB.data;
  } catch {
    insightsB = { data: [] };
  }

  const rowsA = insightsA?.data ?? [];
  if (!Array.isArray(rowsA) || rowsA.length === 0) {
    throw new Error(`Graph /insights(A) veio vazio (${day}).`);
  }

  const reach = toFiniteNumber(pickInsightValueByMetric(insightsA, "reach"));
  let followers = toFiniteNumber(
    pickInsightValueByMetric(insightsA, "follower_count"),
  );

  const profileViews = toFiniteNumber(
    pickInsightValueByMetric(insightsB, "profile_views"),
  );
  const totalInteractions = toFiniteNumber(
    pickInsightValueByMetric(insightsB, "total_interactions"),
  );

  // fallback: followers_count direto do /{igUserId}
  if (!followers) {
    const meUrl =
      `${base}` +
      `?fields=followers_count` +
      `&access_token=${encodeURIComponent(token)}`;

    try {
      const me = await axios.get<{ followers_count?: unknown }>(meUrl, {
        timeout: 15000,
      });
      followers = toFiniteNumber(me.data?.followers_count);
    } catch {
      followers = 0;
    }
  }

  return { reach, profileViews, followers, totalInteractions };
}

type DailyRowLike = {
  reach?: unknown;
  profileViewsTotal?: unknown;
  totalInteractions?: unknown;
};

function isRowAllZero(r: DailyRowLike | null | undefined): boolean {
  if (!r) return true;
  const reach = toFiniteNumber(r?.reach);
  const pv = toFiniteNumber(r?.profileViewsTotal);
  const ti = toFiniteNumber(r?.totalInteractions);
  return reach === 0 && pv === 0 && ti === 0;
}

async function runPromisePool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
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

function triggerInProcessBackfill(params: {
  userId: string;
  instagramAccountId: string;
  igUserId: string;
  pageAccessToken: string;
  daysToFetch: string[];
  refillZeros: boolean;
}) {
  if (!ENABLE_INPROCESS_BACKFILL) {
    console.log(
      "[IG][INPROCESS_BACKFILL] skipped (ENABLE_INPROCESS_BACKFILL=false)",
    );
    return;
  }

  setImmediate(async () => {
    const {
      userId,
      instagramAccountId,
      igUserId,
      pageAccessToken,
      daysToFetch,
      refillZeros,
    } = params;

    console.log("[IG][INPROCESS_BACKFILL] start", {
      userId,
      instagramAccountId,
      igUserId: igUserId ? "ok" : "missing",
      pageAccessToken: pageAccessToken ? "ok" : "missing",
      days: daysToFetch.length,
      concurrency: INPROCESS_BACKFILL_CONCURRENCY,
      refillZeros,
    });

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

        console.log("[IG][INPROCESS_BACKFILL] saved", {
          day: dayYmd,
          reach: toFiniteNumber(g.reach),
          profileViews: toFiniteNumber(g.profileViews),
          totalInteractions: toFiniteNumber(g.totalInteractions),
          followers: toFiniteNumber(g.followers),
        });
      } catch (e) {
        const err = e as AxiosError<unknown>;
        console.error("[IG][INPROCESS_BACKFILL] failed", {
          day: dayYmd,
          message: String((err as any)?.message ?? err),
          response: (err as any)?.response?.data ?? null,
        });
      }
    });

    console.log("[IG][INPROCESS_BACKFILL] done", {
      userId,
      instagramAccountId,
      days: daysToFetch.length,
    });
  });
}

function mapUseCaseCodeToHttp(code?: string): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "INVALID_INPUT":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "NOT_CONNECTED":
      return 409;
    default:
      return 400;
  }
}

/* ===========================
   DB Backfill Job enqueue
=========================== */

// ✅ dedupeKey determinístico (pra não criar 500 jobs iguais)
function buildBackfillDedupeKey(params: {
  userId: string;
  instagramAccountId: string;
  fromYmd: string;
  toYmd: string;
  force: boolean;
  refillZeros: boolean;
}) {
  const f = params.fromYmd.slice(0, 10);
  const t = params.toYmd.slice(0, 10);
  return `ig_daily:${params.userId}:${params.instagramAccountId}:${f}:${t}:force=${
    params.force ? 1 : 0
  }:rz=${params.refillZeros ? 1 : 0}`;
}

async function enqueueBackfillJob(params: {
  userId: string;
  instagramAccountId: string;
  fromYmd: string;
  toYmd: string;
  force: boolean;
  refillZeros: boolean;
}) {
  const { userId, instagramAccountId, fromYmd, toYmd, force, refillZeros } = params;

  const fromDate = dateOnlyUtcFromYmd(fromYmd);
  const toDate = dateOnlyUtcFromYmd(toYmd);
  const dedupeKey = buildBackfillDedupeKey({
    userId,
    instagramAccountId,
    fromYmd,
    toYmd,
    force,
    refillZeros,
  });

  // ✅ dedupe: se já existe um job queued/running com mesmo dedupeKey, reaproveita
  const existing = await prisma.instagramBackfillJob.findFirst({
    where: {
      userId,
      instagramAccountId,
      dedupeKey,
      status: { in: ["queued", "running"] },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, status: true },
  });

  if (existing?.id) {
    if (existing.status !== "running") {
      const updated = await prisma.instagramBackfillJob.update({
        where: { id: existing.id },
        data: {
          status: "queued",
          lastError: null,
          startedAt: null,
          finishedAt: null,
          cursor: null,
        },
        select: { id: true, status: true },
      });
      return updated;
    }
    return existing;
  }

  const created = await prisma.instagramBackfillJob.create({
    data: {
      userId,
      instagramAccountId,
      status: "queued",
      from: fromDate,
      to: toDate,
      dedupeKey,
    },
    select: { id: true, status: true },
  });

  return created;
}

/* ===========================
   Controller
=========================== */

export class InstagramAuthController {
  constructor(
    private readonly authService: IInstagramIgLoginAuthService,
    private readonly completeLogin: CompleteIgLoginUseCase,
    private readonly listAccounts: ListInstagramAccountsUseCase,
    private readonly setActiveAccount: SetActiveInstagramAccountUseCase,
    private readonly dashboardMetrics: GetInstagramDashboardMetricsUseCase,
  ) {}

  async start(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    if (!userId)
      return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    const returnTo =
      s((req.query as Record<string, unknown>)?.returnTo) || IG_RETURN_PATH;

    const rawState = JSON.stringify({
      uid: userId,
      nonce: crypto.randomBytes(12).toString("hex"),
      ts: Date.now(),
      returnTo,
    });

    const signedState = signState(rawState);
    setIgLoginCookie(res, userId);

    const url = this.authService.buildLoginUrl(signedState, false);

    const redirect = parseBool((req.query as Record<string, unknown>)?.redirect);
    if (redirect) return safeRedirect(res, 302, url);

    return safeJson(res, 200, { ok: true, url });
  }

  async callback(req: Request, res: Response) {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");

    if (!code)
      return safeJson(res, 400, { ok: false, message: "code é obrigatório" });

    let userId = getIgLoginCookie(req);
    let returnToFromState: string | null = null;

    if (state) {
      const parsed = safeParseState(state) as unknown as {
        uid?: unknown;
        returnTo?: unknown;
      };
      if (!userId && parsed?.uid) userId = String(parsed.uid);
      if (parsed?.returnTo) returnToFromState = String(parsed.returnTo);
    }

    if (!userId) {
      clearIgLoginCookie(res);

      if (!wantsJson(req)) {
        const url = buildFrontUrl({ ig: "error", reason: "session_expired" });
        return safeRedirect(res, 302, url);
      }

      return safeJson(res, 401, { ok: false, message: "Sessão expirada" });
    }

    const returnTo = returnToFromState || IG_RETURN_PATH;

    try {
      const result = await this.completeLogin.execute(code, state, userId);

      if ((result as any)?.status === "reauth_required") {
        clearIgLoginCookie(res);

        if (!wantsJson(req)) {
          const url = new URL(
            `${FRONT_URL}${returnTo.startsWith("/") ? returnTo : `/${returnTo}`}`,
          );
          url.searchParams.set("ig", "reauth");
          return safeRedirect(res, 302, url.toString());
        }

        return safeJson(res, 200, { ok: true, ...result });
      }

      if ((result as any)?.status === "choose_required") {
        const selectionId = s((result as any)?.selectionId);

        // ✅ TENTA persistir candidatos (não quebra se falhar)
        try {
          const candidatesForDb = await this.completeLogin.getCandidatesForDb({
            selectionId,
            userId: s(userId),
          });

          const data = candidatesForDb
            .map((c: any) => ({
              userId: s(userId),
              selectionId,
              igUserId: s(c.igUserId),
              username: c.username ? s(c.username) : null,
              accountType: c.accountType ? s(c.accountType) : null,
              facebookPageId: s(c.facebookPageId),
              facebookPageName: c.facebookPageName ? s(c.facebookPageName) : null,
              pageAccessToken: s(c.pageAccessToken),
              source: s(c.source),
              instagramAccountId: null as string | null,
            }))
            .filter(
              (c: any) => c.igUserId && c.facebookPageId && c.pageAccessToken && c.source,
            );

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
          // silencioso
        }

        clearIgLoginCookie(res);

        if (!wantsJson(req)) {
          const url = new URL(
            `${FRONT_URL}${returnTo.startsWith("/") ? returnTo : `/${returnTo}`}`,
          );
          url.searchParams.set("ig", "choose");
          url.searchParams.set("selectionId", selectionId);
          return safeRedirect(res, 302, url.toString());
        }

        return safeJson(res, 200, { ok: true, ...result });
      }

      clearIgLoginCookie(res);

      if (!wantsJson(req)) {
        const url = new URL(
          `${FRONT_URL}${returnTo.startsWith("/") ? returnTo : `/${returnTo}`}`,
        );
        url.searchParams.set("ig", "ok");
        return safeRedirect(res, 302, url.toString());
      }

      return safeJson(res, 200, { ok: true, status: "ok" });
    } catch (e) {
      clearIgLoginCookie(res);

      const err = e as { message?: string };

      if (!wantsJson(req)) {
        const url = new URL(
          `${FRONT_URL}${returnTo.startsWith("/") ? returnTo : `/${returnTo}`}`,
        );
        url.searchParams.set("ig", "error");
        url.searchParams.set("reason", s(err?.message ?? "login_failed").slice(0, 140));
        return safeRedirect(res, 302, url.toString());
      }

      return safeJson(res, 500, { ok: false, message: err?.message ?? "Erro no login IG" });
    }
  }

  async candidates(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId)
      return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    let selectionId = s((req.query as Record<string, unknown>)?.selectionId);

    if (!selectionId) {
      const last = await prisma.instagramCandidate.findFirst({
        where: { userId: s(userId) },
        orderBy: candidatesOrderBy(),
        select: { selectionId: true },
      });
      selectionId = s(last?.selectionId);
    }

    // ✅ AJUSTE NECESSÁRIO (segurança): NÃO retornar pageAccessToken pro front
    // O front consegue confirmar usando igUserId ou candidateId.
    const rows = await prisma.instagramCandidate.findMany({
      where: { userId: s(userId), ...(selectionId ? { selectionId } : {}) },
      orderBy: candidatesOrderBy(),
      take: 50,
      select: {
        id: true,
        userId: true,
        selectionId: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        facebookPageName: true,
        source: true,
        instagramAccountId: true,
        createdAt: true,
        selectedAt: true,
        // pageAccessToken: ❌ não expor
      } as any,
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
    if (!userId)
      return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { id: true, activeInstagramAccountId: true },
    });

    const accounts = await prisma.instagramAccount.findMany({
      where: { userId: s(userId), isConnected: true },
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
      } catch {}
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

  async confirm(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return safeJson(res, 401, {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "Não autenticado",
      });
    }

    const body = req.body as Record<string, unknown>;

    const selectionId = s(body.selectionId);
    const igUserIdsRaw = body.igUserIds;
    const candidateIdsRaw = body.candidateIds;

    const igUserIds: string[] = Array.isArray(igUserIdsRaw)
      ? igUserIdsRaw.map((x) => s(x)).filter(Boolean)
      : [];

    const candidateIds: string[] = Array.isArray(candidateIdsRaw)
      ? candidateIdsRaw.map((x) => s(x)).filter(Boolean)
      : [];

    if (!selectionId) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: "selectionId é obrigatório",
      });
    }

    if (igUserIds.length === 0 && candidateIds.length === 0) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: "Envie igUserIds[] (recomendado) ou candidateIds[]",
      });
    }

    const candidates = await prisma.instagramCandidate.findMany({
      where: { userId: s(userId), selectionId },
      orderBy: candidatesOrderBy(),
      take: 200,
    });

    const selected = candidates.filter((c) => {
      const byIg = igUserIds.length > 0 ? igUserIds.includes(s(c.igUserId)) : false;
      const byId = candidateIds.length > 0 ? candidateIds.includes(s(c.id)) : false;
      return byIg || byId;
    });

    if (selected.length === 0) {
      return safeJson(res, 404, {
        ok: false,
        code: "NOT_FOUND",
        message: "Nenhum candidato encontrado para confirmar (selectionId/seleção inválidos).",
      });
    }

    // ✅ selections pro UseCase (ele injeta accessToken/expiresAt e valida token de página)
    const selections = selected
      .map((c) => ({
        igUserId: s(c.igUserId),
        facebookPageId: s(c.facebookPageId),
      }))
      .filter((x) => x.igUserId && x.facebookPageId);

    if (selections.length === 0) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: "Candidatos selecionados não têm igUserId/facebookPageId válidos.",
      });
    }

    let results: Array<{
      igUserId: string;
      username: string;
      accountType: string;
      accessToken: string;
      expiresAt?: Date | string | null;
      facebookPageId?: string | null;
      pageAccessToken?: string | null;
    }> = [];

    try {
      results = await this.completeLogin.confirmSelection({
        selectionId,
        userId: s(userId),
        selections,
      });
    } catch (e) {
      const err = e as { message?: string };
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: s(err?.message ?? "Falha ao confirmar seleção"),
      });
    }

    if (!results.length) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: "Falha ao confirmar seleção (resultado vazio).",
      });
    }

    const createdOrUpdated: Array<{
      id: string;
      igUserId: string;
      username: string | null;
      accountType: string | null;
      facebookPageId: string | null;
      isConnected: boolean;
      updatedAt: Date;
      expiresAt: Date | null;
    }> = [];

    // ✅ Upsert no instagramAccount (mantém seu fluxo e garante tokens)
    for (const r of results) {
      const igUserId = s(r.igUserId);
      const facebookPageId = s(r.facebookPageId);
      const pageAccessToken = s(r.pageAccessToken);
      const accessToken = s(r.accessToken);

      if (!igUserId || !facebookPageId || !pageAccessToken || !accessToken) continue;

      const existing = await prisma.instagramAccount.findFirst({
        where: { userId: s(userId), igUserId },
        select: { id: true },
      });

      // ✅ Normaliza expiresAt antes de salvar (evita Prisma reclamar se vier string)
      const expiresAt = safeDate(r.expiresAt);

      const dataToSet: any = {
        userId: s(userId),
        igUserId,
        facebookPageId,
        pageAccessToken,
        accessToken, // ✅ agora salva também o LONG token do usuário
        expiresAt,
        username: r.username ? s(r.username) : null,
        accountType: r.accountType ? s(r.accountType) : null,
        isConnected: true,
      };

      const acc = existing?.id
        ? await prisma.instagramAccount.update({
            where: { id: existing.id },
            data: dataToSet,
            select: {
              id: true,
              igUserId: true,
              username: true,
              accountType: true,
              facebookPageId: true,
              isConnected: true,
              updatedAt: true,
              expiresAt: true,
            },
          })
        : await prisma.instagramAccount.create({
            data: dataToSet,
            select: {
              id: true,
              igUserId: true,
              username: true,
              accountType: true,
              facebookPageId: true,
              isConnected: true,
              updatedAt: true,
              expiresAt: true,
            },
          });

      createdOrUpdated.push(acc);

      try {
        await prisma.instagramCandidate.updateMany({
          where: { userId: s(userId), selectionId, igUserId },
          data: {
            selectedAt: new Date(),
            instagramAccountId: acc.id,
          },
        });
      } catch {}
    }

    if (createdOrUpdated.length === 0) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: "Contas confirmadas não puderam ser persistidas (tokens inválidos/ausentes).",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { activeInstagramAccountId: true },
    });

    let activeInstagramAccountId = user?.activeInstagramAccountId ?? null;

    if (!activeInstagramAccountId) {
      activeInstagramAccountId = createdOrUpdated[0].id;
      try {
        await prisma.user.update({
          where: { id: s(userId) },
          data: { activeInstagramAccountId },
        });
      } catch {}
    }

    return safeJson(res, 200, {
      ok: true,
      selectionId,
      activeInstagramAccountId,
      confirmed: createdOrUpdated,
    });
  }

  async accounts(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId)
      return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    if (this.listAccounts && typeof (this.listAccounts as any).execute === "function") {
      const out = await (this.listAccounts as any).execute(s(userId));
      return safeJson(res, 200, out);
    }

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { activeInstagramAccountId: true },
    });

    const rows = await prisma.instagramAccount.findMany({
      where: { userId: s(userId), isConnected: true },
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
      } catch {}
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
    if (!userId)
      return safeJson(res, 401, {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "Não autenticado",
      });

    const instagramAccountId = s(
      (req.body as Record<string, unknown>)?.instagramAccountId,
    );
    if (!instagramAccountId) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: "instagramAccountId é obrigatório",
      });
    }

    if (this.setActiveAccount && typeof (this.setActiveAccount as any).execute === "function") {
      const out = await (this.setActiveAccount as any).execute({
        userId: s(userId),
        instagramAccountId,
      });

      if (out && out.ok === false) {
        return safeJson(res, mapUseCaseCodeToHttp(out.code), out);
      }

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
        code: "NOT_FOUND",
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

  async disconnect(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId)
      return safeJson(res, 401, {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "Não autenticado",
      });

    const requestedId = s((req.body as Record<string, unknown>)?.instagramAccountId);

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { activeInstagramAccountId: true },
    });

    const instagramAccountId = requestedId || s(user?.activeInstagramAccountId);
    if (!instagramAccountId) {
      if (!res.headersSent) return res.status(204).send();
      return undefined;
    }

    const acc = await prisma.instagramAccount.findFirst({
      where: { id: instagramAccountId, userId: s(userId) },
      select: { id: true },
    });

    if (!acc)
      return safeJson(res, 404, {
        ok: false,
        code: "NOT_FOUND",
        message: "Conta não encontrada",
      });

    await prisma.instagramAccount.update({
      where: { id: acc.id },
      data: {
        isConnected: false,
        accessToken: null,
        pageAccessToken: null,
        expiresAt: null,
        facebookPageId: null,
      },
    });

    await prisma.user.update({
      where: { id: s(userId) },
      data: { activeInstagramAccountId: null },
    });

    if (!res.headersSent) return res.status(204).send();
    return undefined;
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

    // ✅ NOVO: permite o front escolher a conta explicitamente via query (?instagramAccountId=...)
    // - Se vier e for válida do usuário, usa ela
    // - Senão, mantém fallback padrão (activeInstagramAccountId ou última conta conectada)
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
      return safeJson(res, 404, { ok: false, message: "Conta do Instagram não encontrada" });
    }

    const pageAccessToken = s(account.pageAccessToken);
    const igUserId = s(account.igUserId);
    const hasGraphCreds = !!pageAccessToken && !!igUserId;

    const force = parseBool((req.query as Record<string, unknown>)?.force) ?? false;
    const refillZeros = parseBool((req.query as Record<string, unknown>)?.refillZeros) ?? true;

    const ALWAYS_REFETCH_LAST_DAYS = 7;
    const lastDaysSet = new Set(days.slice(Math.max(0, days.length - ALWAYS_REFETCH_LAST_DAYS)));

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
    for (const r of existing) byDayExisting.set(ymd(r.day), r);

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

      // ✅ followers NÃO é série diária confiável -> deixamos 0 aqui.
      // Followers vai em kpis (snapshot) e o front usa isso.
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

    const totalReach = timeseries.reduce((a, b) => a + toFiniteNumber(b.reach), 0);
    const totalInteractions = timeseries.reduce(
      (a, b) => a + toFiniteNumber(b.totalInteractions),
      0,
    );

    const avgEngagementRate =
      timeseries.reduce((a, b) => a + toFiniteNumber(b.engagementRate), 0) /
      Math.max(1, timeseries.length);

    // ✅✅ AJUSTE NECESSÁRIO:
    // followers deve ser POR CONTA (instagramAccountId) primeiro.
    // Só faz fallback pro MetricsSnapshot (que é global do user/platform) se não houver daily.
    let followersSnapshot = 0;
    let followersSource: "daily_metrics" | "metrics_snapshot" | "instagram_account" | "none" =
      "none";

    let prevFollowers: number | null = null;
    let followersDeltaSource:
      | "daily_prev_day"
      | "prev_day_snapshot"
      | "prev_available_snapshot"
      | "none" = "none";

    // 1) tenta daily do último dia do range (POR CONTA)
    const dayToRow = byDayExisting.get(safeTo);
    const dailyFollowersTo = toFiniteNumber((dayToRow as any)?.followers);

    if (dailyFollowersTo > 0) {
      followersSnapshot = dailyFollowersTo;
      followersSource = "daily_metrics";
    }

    // 2) delta (POR CONTA): tenta daily do dia anterior
    const prevDay = addDaysYmd(safeTo, -1);
    const prevDayRow = byDayExisting.get(prevDay);
    const dailyFollowersPrev = toFiniteNumber((prevDayRow as any)?.followers);

    if (dailyFollowersPrev > 0) {
      prevFollowers = dailyFollowersPrev;
      followersDeltaSource = "daily_prev_day";
    }

    // 3) fallback: MetricsSnapshot (global) só se daily não tiver
    if (!followersSnapshot) {
      try {
        const snap = await prisma.metricsSnapshot.findUnique({
          where: {
            userId_platform_date: {
              userId: s(userId),
              platform: "instagram",
              date: dateOnlyUtcFromYmd(safeTo),
            },
          },
          select: { followers: true },
        });

        const v = toFiniteNumber(snap?.followers);
        if (v > 0) {
          followersSnapshot = v;
          followersSource = "metrics_snapshot";
        }
      } catch {
        // silencioso
      }
    }

    // 4) fallback final: campo de conta (se existir)
    if (!followersSnapshot) {
      const accFollowers = toFiniteNumber((account as any)?.followersCount);
      if (accFollowers > 0) {
        followersSnapshot = accFollowers;
        followersSource = "instagram_account";
      }
    }

    // 5) se não tinha prevFollowers do daily, tenta snapshot do dia anterior
    if (prevFollowers === null) {
      try {
        const prevSnap = await prisma.metricsSnapshot.findUnique({
          where: {
            userId_platform_date: {
              userId: s(userId),
              platform: "instagram",
              date: dateOnlyUtcFromYmd(prevDay),
            },
          },
          select: { followers: true },
        });

        const pv = toFiniteNumber(prevSnap?.followers);
        if (pv > 0) {
          prevFollowers = pv;
          followersDeltaSource = "prev_day_snapshot";
        } else {
          const prevAny = await prisma.metricsSnapshot.findFirst({
            where: {
              userId: s(userId),
              platform: "instagram",
              date: { lt: dateOnlyUtcFromYmd(safeTo) },
            },
            orderBy: { date: "desc" },
            select: { followers: true },
          });

          const pv2 = toFiniteNumber(prevAny?.followers);
          if (pv2 > 0) {
            prevFollowers = pv2;
            followersDeltaSource = "prev_available_snapshot";
          }
        }
      } catch {
        // silencioso
      }
    }

    const netFollowersChange = prevFollowers !== null ? followersSnapshot - prevFollowers : 0;

    const followersGained =
      prevFollowers !== null && netFollowersChange > 0 ? netFollowersChange : 0;

    const followersLost =
      prevFollowers !== null && netFollowersChange < 0 ? Math.abs(netFollowersChange) : 0;

    const allZero =
      timeseries.length > 0 &&
      timeseries.every(
        (x) =>
          toFiniteNumber(x.reach) === 0 &&
          toFiniteNumber(x.profileViews) === 0 &&
          toFiniteNumber(x.totalInteractions) === 0,
      );

    const summary = buildWindowsSummary(timeseries);

    const shouldAutoBackfill =
      parseBool((req.query as Record<string, unknown>)?.autoBackfill) ?? true;

    let backfillQueued = false;
    let backfillJobId: string | null = null;
    let backfillTriggeredInprocess = false;

    const backfillMode = String(
      (req.query as Record<string, unknown>)?.backfillMode ?? "",
    ).toLowerCase();
    const wantsInprocess = backfillMode === "inprocess";
    const wantsDb = backfillMode === "db";

    if (shouldAutoBackfill && hasGraphCreds && suggestedFetchDays.length > 0) {
      const preferDb = wantsDb || (PREFER_DB_BACKFILL && !wantsInprocess);

      if (preferDb) {
        try {
          const job = await enqueueBackfillJob({
            userId: s(userId),
            instagramAccountId: account.id,
            fromYmd: safeFrom,
            toYmd: safeTo,
            force,
            refillZeros,
          });
          backfillQueued = true;
          backfillJobId = (job as any).id ?? null;
        } catch (e) {
          const err = e as { message?: string };
          console.error("[IG][BACKFILL][ENQUEUE] failed", {
            message: String(err?.message ?? err),
          });

          // fallback: se falhar enfileirar no DB, tenta in-process
          if (ENABLE_INPROCESS_BACKFILL) {
            triggerInProcessBackfill({
              userId: s(userId),
              instagramAccountId: account.id,
              igUserId,
              pageAccessToken,
              daysToFetch: suggestedFetchDays,
              refillZeros,
            });
            backfillTriggeredInprocess = true;
          }
        }
      } else {
        triggerInProcessBackfill({
          userId: s(userId),
          instagramAccountId: account.id,
          igUserId,
          pageAccessToken,
          daysToFetch: suggestedFetchDays,
          refillZeros,
        });
        backfillTriggeredInprocess = true;
      }
    }

    const resolvedBackfillMode = backfillQueued
      ? "db"
      : backfillTriggeredInprocess
        ? "inprocess"
        : "none";

    return safeJson(res, 200, {
      ok: true,
      // ✅ NOVO: ecoa o que veio do front (pra debug)
      requestedInstagramAccountId: requestedInstagramAccountId || null,
      activeInstagramAccountId: user?.activeInstagramAccountId ?? null,
      instagramAccountIdUsed: account.id,
      filters: { from: safeFrom, to: safeTo },
      kpis: {
        followers: followersSnapshot,
        followersGained,
        followersLost,
        netFollowersChange,
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
        backfillQueued,
        backfillJobId,
        backfillMode: resolvedBackfillMode,
        hint: !hasGraphCreds
          ? "Sem credenciais do Graph (pageAccessToken/igUserId)."
          : suggestedFetchDays.length > 0 && shouldAutoBackfill
            ? backfillQueued
              ? "Backfill enfileirado no DB (worker vai preencher fora da request)."
              : backfillTriggeredInprocess
                ? "Backfill in-process disparado (fallback/DEBUG)."
                : "Faltam dias, mas não foi possível enfileirar/disparar backfill."
            : allZero
              ? "Tudo zerado (provável falta de histórico no banco)."
              : "OK",
        followersNote:
          "followers é snapshot (último valor do período). Não interpretar como ganho/perda diária.",
        followersSource,
        followersDeltaSource,
        prevFollowers: prevFollowers ?? null,
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
          preferDbBackfill: PREFER_DB_BACKFILL,
        },
      },
    });
  }
}