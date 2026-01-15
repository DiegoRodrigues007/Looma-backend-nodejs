import { Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
import type { AxiosResponse } from "axios";
import { IInstagramIgLoginAuthService } from "../../../application/instagram/IInstagramIgLoginAuthService";
import {
  CompleteIgLoginUseCase,
  InstagramLoginReauthRequired,
  InstagramLoginChooseRequired,
} from "../../../application/instagram/CompleteIgLoginUseCase";
import { prisma } from "../../../infrastructure/db/prismaClient";

/* =========================
   Tipos (Graph API)
========================= */

type IgMediaItem = {
  id: string;
  timestamp: string;
  like_count?: number | string;
  comments_count?: number | string;

  caption?: string | null;
  media_type?: string;
  media_url?: string | null;
  thumbnail_url?: string | null;
  permalink?: string | null;
};

type IgMediaResponse = {
  data: IgMediaItem[];
  paging?: {
    cursors?: { after?: string };
    next?: string;
  };
};

type IgInsightRow = {
  name?: string;
  period?: string;
  values?: Array<{ value?: any; end_time?: string }>;
  value?: any;
  total_value?: any;
};

type IgInsightsResponse = {
  data: IgInsightRow[];
};

/* =========================
   Helpers de data
========================= */

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseYmd(ymdStr: string): Date {
  return new Date(`${ymdStr}T00:00:00.000Z`);
}

function listDays(from: string, to: string): string[] {
  const start = parseYmd(from);
  const end = parseYmd(to);

  const days: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(ymd(d));
  }
  return days;
}

/**
 * Graph API às vezes devolve números em formatos como:
 * - 12
 * - "12"
 * - { value: 12 }
 * - { value: { value: 12 } }
 * - { total_value: { value: 12 } }
 * - { values: [{ value: 12 }] }
 */
function toFiniteNumber(v: any): number {
  const unwrap = (x: any): any => {
    if (x == null) return 0;

    if (typeof x === "number" || typeof x === "string") return x;

    if (typeof x === "object") {
      if ("total_value" in x) return unwrap((x as any).total_value);
      if ("value" in x) return unwrap((x as any).value);

      if (Array.isArray((x as any).values) && (x as any).values.length > 0) {
        const first = (x as any).values[0];
        return unwrap(first?.value ?? first);
      }

      return 0;
    }

    return 0;
  };

  const n = Number(unwrap(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * ✅ Mapper robusto por dia
 * - usa values[] quando existe
 * - se não existir values, joga total no último dia (fallback)
 */
function mapInsightByDayRobust(
  insightsData: any[],
  metricName: string,
  days: string[],
  fallbackValue = 0
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) out[d] = 0;

  const item = insightsData?.find((x: any) => x?.name === metricName);
  if (!item) return out;

  const values = item?.values;
  if (Array.isArray(values) && values.length > 0) {
    for (const v of values) {
      const endTime: string | undefined = v?.end_time;
      if (!endTime) continue;

      const day = endTime.slice(0, 10);
      out[day] = toFiniteNumber(v?.value);
    }
    return out;
  }

  const total = toFiniteNumber(item?.total_value ?? item?.value ?? fallbackValue);
  const lastDay = days[days.length - 1];
  out[lastDay] = total;

  return out;
}

function getAuthenticatedUserId(req: Request): string | null {
  const anyReq = req as any;

  const fromUser =
    anyReq?.user?.sub ||
    anyReq?.user?.id ||
    anyReq?.user?.userId ||
    anyReq?.userId ||
    null;

  if (typeof fromUser === "string" && fromUser.trim().length > 0) return fromUser.trim();
  if (typeof fromUser === "number") return String(fromUser);

  const fromHeader = req.header("x-user-id");
  if (typeof fromHeader === "string" && fromHeader.trim().length > 0) return fromHeader.trim();

  return null;
}

const IG_LOGIN_UID_COOKIE = "ig_login_uid";

function setIgLoginCookie(res: Response, userId: string) {
  res.cookie(IG_LOGIN_UID_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
}

function getIgLoginCookie(req: Request): string | null {
  const anyReq = req as any;
  const v = anyReq?.cookies?.[IG_LOGIN_UID_COOKIE];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clearIgLoginCookie(res: Response) {
  res.clearCookie(IG_LOGIN_UID_COOKIE, { path: "/" });
}

const STATE_SIGN_SECRET =
  process.env.IG_STATE_SIGN_SECRET || process.env.JWT_SECRET || "dev_secret_change_me";

function signState(payload: string) {
  const h = crypto.createHmac("sha256", STATE_SIGN_SECRET).update(payload).digest("hex");
  return `${payload}.${h}`;
}

function verifyState(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx <= 0) return null;

  const payload = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);

  const expected = crypto.createHmac("sha256", STATE_SIGN_SECRET).update(payload).digest("hex");
  if (sig.length !== expected.length) return null;

  const ok = crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"));
  return ok ? payload : null;
}

function safeParseState(state: string): { uid?: string; returnTo?: string } {
  const verified = verifyState(state);
  if (!verified) return {};

  try {
    const parsed = JSON.parse(verified);
    return {
      uid: parsed?.uid != null ? String(parsed.uid) : undefined,
      returnTo: typeof parsed?.returnTo === "string" ? String(parsed.returnTo) : undefined,
    };
  } catch {
    return {};
  }
}

function parseRedirectParam(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;

  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;

  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
    if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  }

  return true;
}

function isInstagramTokenInvalid(err: any): boolean {
  const data = err?.response?.data;
  const code = data?.error?.code;
  const subcode = data?.error?.error_subcode;
  const message = String(data?.error?.message ?? "").toLowerCase();

  if (code === 190) return true;
  if (typeof subcode === "number" && [458, 459, 460, 463, 464, 467].includes(subcode)) return true;
  if (message.includes("invalid oauth access token")) return true;
  if (message.includes("session has expired")) return true;
  if (message.includes("has been invalidated")) return true;

  return false;
}

/* =========================
   Followers daily helpers (DB)
========================= */

async function getFollowersSeriesFromDb(opts: {
  userId: string;
  igUserId: string;
  days: string[];
  fallbackFollowers: number;
}): Promise<{ followersByDay: Record<string, number>; hasHistory: boolean }> {
  const { userId, igUserId, days, fallbackFollowers } = opts;

  try {
    const from = parseYmd(days[0]);
    const to = parseYmd(days[days.length - 1]);

    // @ts-ignore
    const rows = await prisma.instagramFollowersDaily.findMany({
      where: {
        userId,
        igUserId,
        day: { gte: from, lte: to },
      },
      orderBy: { day: "asc" },
      select: { day: true, followers: true },
    });

    const map: Record<string, number> = {};
    for (const r of rows) {
      map[ymd(new Date(r.day))] = toFiniteNumber(r.followers);
    }

    const hasHistory = rows.length > 0;

    let last = hasHistory ? map[days[0]] ?? fallbackFollowers : fallbackFollowers;
    for (const day of days) {
      if (map[day] == null) {
        map[day] = last;
      } else {
        last = map[day];
      }
    }

    return { followersByDay: map, hasHistory };
  } catch {
    const map: Record<string, number> = {};
    for (const day of days) map[day] = fallbackFollowers;
    return { followersByDay: map, hasHistory: false };
  }
}

async function saveTodayFollowersSnapshot(opts: { userId: string; igUserId: string; followers: number }) {
  const { userId, igUserId, followers } = opts;

  try {
    const today = ymd(new Date());
    const dayDate = parseYmd(today);

    // @ts-ignore
    await prisma.instagramFollowersDaily.upsert({
      where: {
        userId_igUserId_day: { userId, igUserId, day: dayDate },
      },
      update: { followers },
      create: { userId, igUserId, day: dayDate, followers },
    });
  } catch {
    // silencioso
  }
}

/* =========================
   asyncPool correto
========================= */

async function asyncPool<T, R>(
  poolLimit: number,
  array: T[],
  iteratorFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const ret: Promise<R>[] = [];
  const executing = new Set<Promise<any>>();

  for (let i = 0; i < array.length; i++) {
    const p = Promise.resolve().then(() => iteratorFn(array[i], i));
    ret.push(p);

    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);

    if (executing.size >= poolLimit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(ret);
}

/* =========================
   Daily interactions by posts
========================= */

async function fetchDailyInteractionsByPosts(opts: {
  igUserId: string;
  accessToken: string;
  from: string;
  to: string;
  graph: ReturnType<typeof axios.create>;
}) {
  const { igUserId, accessToken, from, to, graph } = opts;

  const fromTs = parseYmd(from).getTime();
  const toTs = parseYmd(to).getTime() + 86399999;

  const allMedia: IgMediaItem[] = [];
  let after: string | undefined = undefined;

  for (let guard = 0; guard < 30; guard++) {
    const mediaRes: AxiosResponse<IgMediaResponse> = await graph.get<IgMediaResponse>(`/${igUserId}/media`, {
      params: {
        fields: "id,timestamp,like_count,comments_count",
        limit: 100,
        after,
        access_token: accessToken,
      },
    });

    const data: IgMediaItem[] = mediaRes.data?.data ?? [];
    allMedia.push(...data);

    const nextAfter = mediaRes.data?.paging?.cursors?.after;
    if (!nextAfter) break;
    after = nextAfter;

    const oldest = data[data.length - 1]?.timestamp;
    if (oldest) {
      const oldestTs = new Date(oldest).getTime();
      if (oldestTs < fromTs) break;
    }
  }

  const inRange = allMedia.filter((m) => {
    const ts = new Date(m.timestamp).getTime();
    return ts >= fromTs && ts <= toTs;
  });

  const likesByDay: Record<string, number> = {};
  const commentsByDay: Record<string, number> = {};
  const sharesByDay: Record<string, number> = {};
  const savesByDay: Record<string, number> = {};
  const totalByDay: Record<string, number> = {};

  const add = (map: Record<string, number>, day: string, v: number) => {
    map[day] = (map[day] ?? 0) + (Number.isFinite(v) ? v : 0);
  };

  for (const m of inRange) {
    const day = ymd(new Date(m.timestamp));
    const likes = toFiniteNumber(m.like_count);
    const comments = toFiniteNumber(m.comments_count);

    add(likesByDay, day, likes);
    add(commentsByDay, day, comments);
    add(totalByDay, day, likes + comments);
  }

  await asyncPool(6, inRange, async (m) => {
    try {
      const insightsRes: AxiosResponse<IgInsightsResponse> = await graph.get<IgInsightsResponse>(`/${m.id}/insights`, {
        params: {
          metric: "shares,saved",
          access_token: accessToken,
        },
      });

      const arr = insightsRes.data?.data ?? [];

      const pickValue = (row: IgInsightRow): number => {
        const v = row?.values?.[0]?.value ?? row?.total_value ?? row?.value ?? row ?? 0;
        return toFiniteNumber(v);
      };

      const map: Record<string, number> = {};
      for (const r of arr) {
        const name = String(r?.name ?? "");
        map[name] = pickValue(r);
      }

      const shares = toFiniteNumber(map.shares);
      const saved = toFiniteNumber(map.saved);

      const day = ymd(new Date(m.timestamp));

      add(sharesByDay, day, shares);
      add(savesByDay, day, saved);
      add(totalByDay, day, shares + saved);
    } catch {
      // silencioso
    }
  });

  return { likesByDay, commentsByDay, sharesByDay, savesByDay, totalByDay };
}

/* =========================
   Top Content (db-first + api fallback)
========================= */

async function fetchTopContentFromDb(opts: {
  userId: string;
  from: string;
  to: string;
  followersBase: number;
}) {
  const { userId, from, to, followersBase } = opts;

  const fromDate = parseYmd(from);
  const toDate = new Date(parseYmd(to).getTime() + 86399999);

  const posts = await prisma.instagramPost.findMany({
    where: {
      userId,
      publishedAt: { gte: fromDate, lte: toDate },
    },
    orderBy: { publishedAt: "desc" },
    take: 200,
    include: {
      metrics: { orderBy: { pulledAt: "desc" }, take: 1 },
    },
  });

  if (!posts.length) return null;

  const denom = Math.max(1, toFiniteNumber(followersBase));

  const items = posts
    .map((p) => {
      const m = p.metrics?.[0];

      const likes = toFiniteNumber((p as any).likeCount);
      const comments = toFiniteNumber((p as any).commentsCount);

      const reach = toFiniteNumber((m as any)?.reach);
      const shares = toFiniteNumber((m as any)?.shares);
      const saved = toFiniteNumber((m as any)?.saves);
      const totalInteractions =
        toFiniteNumber((m as any)?.totalInteractions) || likes + comments + shares + saved;

      const plays = toFiniteNumber((m as any)?.plays);
      const videoViews = toFiniteNumber((m as any)?.videoViews);
      const views = plays || videoViews || null;

      return {
        id: String((p as any).igMediaId),
        permalink: String((p as any).permalink ?? ""),
        caption: (p as any).caption ?? null,
        thumb: (p as any).thumb ?? null,
        mediaType: String((p as any).mediaType ?? "IMAGE"),
        publishedAt: (p as any).publishedAt.toISOString(),
        engagementRate: ((likes + comments) / denom) * 100,
        likes,
        comments,
        views,
        insights: {
          plays: plays || null,
          videoViews: videoViews || null,
          reach: reach || null,
          totalInteractions: totalInteractions || null,
          shares: shares || null,
          saved: saved || null,
        },
      };
    })
    .sort((a, b) => (b.insights?.totalInteractions ?? 0) - (a.insights?.totalInteractions ?? 0))
    .slice(0, 6);

  return items;
}

async function fetchTopContent(opts: {
  igUserId: string;
  accessToken: string;
  from: string;
  to: string;
  followersBase: number;
  graph: ReturnType<typeof axios.create>;
}) {
  const { igUserId, accessToken, from, to, followersBase, graph } = opts;

  const fromTs = parseYmd(from).getTime();
  const toTs = parseYmd(to).getTime() + 86399999;

  const mediaRes: AxiosResponse<IgMediaResponse> = await graph.get<IgMediaResponse>(`/${igUserId}/media`, {
    params: {
      fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
      limit: 50,
      access_token: accessToken,
    },
  });

  const data = mediaRes.data?.data ?? [];
  const denom = Math.max(1, toFiniteNumber(followersBase));

  const items = data
    .filter((m) => {
      const ts = new Date(m.timestamp).getTime();
      return ts >= fromTs && ts <= toTs;
    })
    .map((m) => {
      const likes = toFiniteNumber(m.like_count);
      const comments = toFiniteNumber(m.comments_count);
      const engagement = likes + comments;

      const mediaType = String(m.media_type ?? "IMAGE");
      const thumb = m.thumbnail_url || m.media_url || null;

      return {
        id: String(m.id),
        permalink: String(m.permalink ?? ""),
        caption: m.caption ?? null,
        thumb,
        mediaType,
        publishedAt: String(m.timestamp ?? ""),
        engagementRate: (engagement / denom) * 100,
        likes,
        comments,
        views: null as number | null,
        insights: null as
          | null
          | {
              plays?: number | null;
              videoViews?: number | null;
              reach?: number | null;
              totalInteractions?: number | null;
              shares?: number | null;
              saved?: number | null;
            },
      };
    })
    .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))
    .slice(0, 6);

  const enriched = await Promise.all(
    items.map(async (it) => {
      try {
        const insightsRes: AxiosResponse<IgInsightsResponse> = await graph.get<IgInsightsResponse>(`/${it.id}/insights`, {
          params: {
            metric: "plays,video_views,reach,total_interactions,shares,saved",
            access_token: accessToken,
          },
        });

        const arr = insightsRes.data?.data ?? [];

        const pickValue = (row: IgInsightRow): number | null => {
          const v = row?.values?.[0]?.value ?? row?.total_value ?? row?.value ?? row ?? null;
          const n = toFiniteNumber(v);
          return Number.isFinite(n) ? n : null;
        };

        const map: Record<string, number | null> = {};
        for (const r of arr) {
          const name = String(r?.name ?? "");
          map[name] = pickValue(r);
        }

        const plays = map.plays ?? null;
        const videoViews = map.video_views ?? null;

        return {
          ...it,
          views: plays ?? videoViews ?? null,
          insights: {
            plays,
            videoViews,
            reach: map.reach ?? null,
            totalInteractions: map.total_interactions ?? null,
            shares: map.shares ?? null,
            saved: map.saved ?? null,
          },
        };
      } catch {
        return it;
      }
    })
  );

  return enriched;
}

/* =========================
   Backfill enqueue (multi-conta)
========================= */

async function enqueueInstagramBackfill(opts: { userId: string; instagramAccountId: string }) {
  const { userId, instagramAccountId } = opts;

  const existing = await prisma.instagramBackfillJob.findFirst({
    where: {
      userId,
      instagramAccountId,
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) return existing;

  const job = await prisma.instagramBackfillJob.create({
    data: {
      userId,
      instagramAccountId,
      status: "queued",
    },
  });

  return job;
}

/* =========================
   Helpers multi-conta (metrics)
========================= */

function getInstagramAccountIdFromQuery(req: Request): string | null {
  const v = req.query.instagramAccountId ?? req.query.accountId;
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

async function getInstagramAccountForRequest(userId: string, instagramAccountId?: string | null) {
  if (instagramAccountId) {
    return prisma.instagramAccount.findFirst({
      where: { id: instagramAccountId, userId },
      orderBy: { updatedAt: "desc" },
    });
  }

  return prisma.instagramAccount.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

/* =========================
   Response helpers (evita headers sent)
========================= */

function safeJson(res: Response, status: number, body: any) {
  if (res.headersSent) return;
  res.status(status).json(body);
}

function safeRedirect(res: Response, status: number, url: string) {
  if (res.headersSent) return;
  res.redirect(status, url);
}

function buildFrontRedirect(opts: { returnTo: string; params: Record<string, string> }) {
  const frontUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const { returnTo, params } = opts;

  const base = `${frontUrl}${returnTo.startsWith("/") ? returnTo : "/settings"}`;
  const qs = new URLSearchParams(params);
  return `${base}${base.includes("?") ? "&" : "?"}${qs.toString()}`;
}

/* =========================
   Controller
========================= */

export class InstagramAuthController {
  constructor(
    private readonly authService: IInstagramIgLoginAuthService,
    private readonly completeLogin: CompleteIgLoginUseCase
  ) {}

  async start(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      safeJson(res, 401, { message: "Não autenticado" });
      return;
    }

    const stateFromQuery = String(req.query.state ?? "").trim();
    const redirect = parseRedirectParam(req.query.redirect);
    const returnTo = stateFromQuery.length > 0 ? stateFromQuery : "/settings";

    const rawState = JSON.stringify({
      returnTo,
      uid: userId,
      nonce: crypto.randomBytes(12).toString("hex"),
      ts: Date.now(),
    });

    const signedState = signState(rawState);

    setIgLoginCookie(res, userId);

    const url = this.authService.buildLoginUrl(signedState, false);

    reminderLogSafe("[IG] start", { userId, returnTo, redirect });

    if (!redirect) {
      safeJson(res, 200, { url, state: signedState });
      return;
    }

    safeRedirect(res, 302, url);
  }

  /**
   * ✅ Callback agora NÃO salva a conta automaticamente.
   * Ele retorna choose_required com candidates para o frontend escolher.
   */
  async callback(req: Request, res: Response): Promise<void> {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    const redirect = parseRedirectParam(req.query.redirect);

    if (!code) {
      safeJson(res, 400, { message: "code é obrigatório" });
      return;
    }

    let userId = getIgLoginCookie(req);

    let returnTo = "/settings";
    if (state) {
      const parsed = safeParseState(state);
      if (!userId && parsed.uid) userId = parsed.uid;

      if (parsed.returnTo && parsed.returnTo.startsWith("/")) {
        returnTo = parsed.returnTo;
      }
    }

    if (!userId) {
      safeJson(res, 401, {
        message: "Sessão do login do Instagram expirou. Inicie o login novamente.",
      });
      return;
    }

    reminderLogSafe("[IG] callback (before execute)", {
      hasCode: !!code,
      hasState: !!state,
      userId,
      returnTo,
      redirect,
    });

    try {
      const result = (await this.completeLogin.execute(
        code,
        state ?? "",
        userId
      )) as InstagramLoginReauthRequired | InstagramLoginChooseRequired;

      // 1) reauth_required -> rerequest
      if (result?.status === "reauth_required") {
        const missing = Array.isArray(result?.missingPermissions) ? result.missingPermissions : [];

        reminderLogSafe("[IG] reauth required -> rerequest", {
          userId,
          missingPermissions: missing,
        });

        const rerequestUrl = this.authService.buildLoginUrl(state, true);

        // ✅ se o caller não quer redirect, devolve JSON com a url
        if (!redirect) {
          clearIgLoginCookie(res); // header antes da resposta
          safeJson(res, 200, {
            status: "reauth_required",
            missingPermissions: missing,
            url: rerequestUrl,
            returnTo,
          });
          return;
        }

        // ✅ redirect
        clearIgLoginCookie(res);
        safeRedirect(res, 302, rerequestUrl);
        return;
      }

      // 2) choose_required -> envia pro front
      if (result?.status === "choose_required") {
        // ✅ cookie pode ser limpo aqui (já temos selectionId)
        clearIgLoginCookie(res);

        reminderLogSafe("[IG] choose_required", {
          userId,
          selectionId: result.selectionId,
          candidatesCount: result.candidates?.length ?? 0,
        });

        if (!redirect) {
          safeJson(res, 200, {
            status: "choose_required",
            selectionId: result.selectionId,
            candidates: result.candidates,
            returnTo,
          });
          return;
        }

        // ✅ redireciona o usuário para o front já com selectionId
        const redirectUrl = buildFrontRedirect({
          returnTo,
          params: {
            instagram: "choose",
            selectionId: String(result.selectionId),
          },
        });

        safeRedirect(res, 302, redirectUrl);
        return;
      }

      // fallback inesperado
      clearIgLoginCookie(res);
      if (!redirect) {
        safeJson(res, 500, { message: "Resposta inesperada no callback do Instagram" });
        return;
      }

      const redirectUrl = buildFrontRedirect({
        returnTo,
        params: { instagram: "error", reason: "unexpected_callback_response" },
      });
      safeRedirect(res, 302, redirectUrl);
      return;
    } catch (err: any) {
      console.error("[IG] callback error:", err?.response?.data ?? err);

      // ✅ IMPORTANTÍSSIMO:
      // limpar cookie ANTES de responder (evita "Cannot set headers after they are sent")
      clearIgLoginCookie(res);

      const details = err?.response?.data ?? (err?.message ? String(err.message) : String(err));
      const msg = "Erro ao completar login do Instagram";

      if (!redirect) {
        safeJson(res, 500, { message: msg, details });
        return;
      }

      // ✅ se veio via redirect, manda pro front com erro (sem estourar headers)
      const redirectUrl = buildFrontRedirect({
        returnTo,
        params: {
          instagram: "error",
          message: msg,
        },
      });

      safeRedirect(res, 302, redirectUrl);
      return;
    }
  }

  /**
   * ✅ NOVO endpoint:
   * Frontend chama após o usuário escolher 1..N contas.
   *
   * Body:
   * {
   *   selectionId: string,
   *   selections: [{ igUserId: string, facebookPageId: string }, ...],
   *   returnTo?: string,
   *   redirect?: boolean
   * }
   */
  async confirm(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      safeJson(res, 401, { message: "Não autenticado" });
      return;
    }

    const selectionId = String((req.body as any)?.selectionId ?? "").trim();
    const selections = (req.body as any)?.selections;
    const returnToRaw = String((req.body as any)?.returnTo ?? "/settings");
    const redirect = parseRedirectParam((req.body as any)?.redirect);

    const returnTo = returnToRaw.startsWith("/") ? returnToRaw : "/settings";

    if (!selectionId) {
      safeJson(res, 400, { message: "selectionId é obrigatório" });
      return;
    }
    if (!Array.isArray(selections) || selections.length === 0) {
      safeJson(res, 400, { message: "Selecione ao menos uma conta" });
      return;
    }

    try {
      const results = await this.completeLogin.confirmSelection({
        selectionId,
        userId,
        selections,
      });

      // ✅ enfileirar backfill para cada conta conectada
      const connectedAccountIds: string[] = [];

      for (const r of results) {
        const igUserId = String(r.igUserId);
        const facebookPageId = r.facebookPageId ? String(r.facebookPageId) : null;

        // tenta achar a conta criada/atualizada pelo tokenStore
        const acc = await prisma.instagramAccount.findFirst({
          where: {
            userId,
            instagramId: igUserId,
            ...(facebookPageId ? { facebookPageId } : {}),
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });

        if (acc?.id) connectedAccountIds.push(acc.id);
      }

      for (const id of connectedAccountIds) {
        const job = await enqueueInstagramBackfill({ userId, instagramAccountId: id });
        reminderLogSafe("[IG] backfill enqueued", {
          userId,
          instagramAccountId: id,
          jobId: job.id,
          status: job.status,
        });
      }

      if (!redirect) {
        safeJson(res, 200, {
          status: "ok",
          accounts: results,
          instagramAccountIds: connectedAccountIds,
        });
        return;
      }

      const redirectUrl = buildFrontRedirect({
        returnTo,
        params: { instagram: "connected" },
      });

      safeRedirect(res, 302, redirectUrl);
      return;
    } catch (err: any) {
      console.error("[IG] confirm error:", err?.response?.data ?? err);

      safeJson(res, 500, {
        message: "Erro ao confirmar conexão do Instagram",
        details: err?.response?.data ?? String(err),
      });
      return;
    }
  }

  async status(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      safeJson(res, 401, { connected: false, message: "Não autenticado" });
      return;
    }

    const row = await prisma.instagramAccount.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    const connected = !!row?.isConnected && (!!row?.pageAccessToken || !!row?.accessToken);

    reminderLogSafe("[IG] status", {
      userId,
      hasRow: !!row,
      instagramId: row?.instagramId ?? null,
      instagramAccountId: row?.id ?? null,
      isConnected: row?.isConnected ?? false,
      hasAccessToken: !!row?.accessToken,
      hasPageAccessToken: !!row?.pageAccessToken,
      computedConnected: connected,
    });

    safeJson(res, 200, {
      connected,
      instagramAccountId: row?.id ?? null,
      igUserId: row?.instagramId ?? null,
      username: row?.instagramUserName ?? null,
      accountType: row?.accountType ?? null,
      expiresAt: row?.accessTokenExpiresAt ?? null,
    });
  }

  async disconnect(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      safeJson(res, 401, { message: "Não autenticado" });
      return;
    }

    await prisma.instagramAccount.updateMany({
      where: { userId },
      data: {
        isConnected: false,
        accessToken: null,
        pageAccessToken: null,
        accessTokenExpiresAt: null,
        grantedScopes: null,
        facebookPageId: null,
      },
    });

    reminderLogSafe("[IG] disconnect", { userId });

    if (!res.headersSent) res.status(204).send();
  }

  async metrics(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      safeJson(res, 401, { message: "Não autenticado" });
      return;
    }

    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");

    if (!from || !to) {
      safeJson(res, 400, { message: "from e to são obrigatórios no formato YYYY-MM-DD" });
      return;
    }

    const instagramAccountId = getInstagramAccountIdFromQuery(req);
    const row = await getInstagramAccountForRequest(userId, instagramAccountId);

    if (!row || !row.isConnected || !row.instagramId || (!row.pageAccessToken && !row.accessToken)) {
      safeJson(res, 409, { message: "Instagram não conectado" });
      return;
    }

    const igUserId = row.instagramId;
    const accessToken = row.pageAccessToken ?? row.accessToken!;
    const graphBaseUrl = process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";

    const since = Math.floor(parseYmd(from).getTime() / 1000);
    const until = Math.floor((parseYmd(to).getTime() + 86399999) / 1000);

    const graph = axios.create({ baseURL: graphBaseUrl, timeout: 15000 });

    try {
      const profileRes = await graph.get(`/${igUserId}`, {
        params: {
          fields: "followers_count,username",
          access_token: accessToken,
        },
      });

      const currentFollowers = toFiniteNumber(profileRes.data?.followers_count);
      const username = String(profileRes.data?.username ?? row.instagramUserName ?? "");

      await saveTodayFollowersSnapshot({ userId, igUserId, followers: currentFollowers });

      const days = listDays(from, to);

      const reachRes = await graph.get(`/${igUserId}/insights`, {
        params: {
          metric: "reach",
          period: "day",
          since,
          until,
          access_token: accessToken,
        },
      });

      const profileViewsRes = await graph.get(`/${igUserId}/insights`, {
        params: {
          metric: "profile_views",
          metric_type: "total_value",
          period: "day",
          since,
          until,
          access_token: accessToken,
        },
      });

      const reachData = reachRes.data?.data ?? [];
      const profileViewsData = profileViewsRes.data?.data ?? [];

      const reachByDay = mapInsightByDayRobust(reachData, "reach", days, 0);
      const profileViewsByDay = mapInsightByDayRobust(profileViewsData, "profile_views", days, 0);

      const { followersByDay, hasHistory } = await getFollowersSeriesFromDb({
        userId,
        igUserId,
        days,
        fallbackFollowers: currentFollowers,
      });

      const daily = await fetchDailyInteractionsByPosts({
        igUserId,
        accessToken,
        from,
        to,
        graph,
      });

      const timeseries = days.map((day) => {
        const reach = reachByDay[day] ?? 0;
        const profileViews = profileViewsByDay[day] ?? 0;

        const totalInteractions = daily.totalByDay[day] ?? 0;
        const engagementRate = reach > 0 ? (totalInteractions / reach) * 100 : 0;

        const followers = followersByDay[day] ?? currentFollowers;

        return { date: day, followers, reach, profileViews, totalInteractions, engagementRate };
      });

      const totalReach = timeseries.reduce((acc, t) => acc + (t.reach ?? 0), 0);
      const totalInteractions = timeseries.reduce((acc, t) => acc + (t.totalInteractions ?? 0), 0);
      const avgEngagementRate =
        timeseries.length > 0
          ? timeseries.reduce((acc, t) => acc + (t.engagementRate ?? 0), 0) / timeseries.length
          : 0;

      const followersKpi = timeseries[timeseries.length - 1]?.followers ?? currentFollowers;

      // ✅ TOP CONTENT DB-FIRST
      let topContent: any[] = [];
      try {
        const dbTop = await fetchTopContentFromDb({
          userId,
          from,
          to,
          followersBase: currentFollowers,
        });

        if (dbTop && dbTop.length > 0) {
          topContent = dbTop;
        } else {
          topContent = await fetchTopContent({
            igUserId,
            accessToken,
            from,
            to,
            followersBase: currentFollowers,
            graph,
          });
        }
      } catch (e: any) {
        console.warn("[IG] topContent warning:", e?.response?.data ?? e?.message ?? e);
        topContent = [];
      }

      safeJson(res, 200, {
        filters: { from, to, granularity: "day", providers: ["instagram"] },
        kpis: {
          followers: followersKpi,
          reach: totalReach,
          totalInteractions,
          engagementRate: avgEngagementRate,
        },
        timeseries,
        topContent,
        account: { igUserId, username, instagramAccountId: row.id },
        meta: {
          followersHistorySource: hasHistory ? "db" : "fallback",
          interactionsSource: "posts_sum",
          profileViewsSource: "ig_insights_total_value",
          topContentSource: topContent.length ? "db_or_api" : "none",
        },
      });
      return;
    } catch (err: any) {
      console.error("[IG] metrics error:", err?.response?.data ?? err);

      if (isInstagramTokenInvalid(err)) {
        await prisma.instagramAccount.update({
          where: { id: row.id },
          data: {
            isConnected: false,
            accessToken: null,
            pageAccessToken: null,
            accessTokenExpiresAt: null,
            grantedScopes: null,
            facebookPageId: null,
          },
        });

        safeJson(res, 409, { message: "Token inválido/expirado. Reconecte o Instagram." });
        return;
      }

      safeJson(res, 500, {
        message: "Erro ao buscar métricas do Instagram",
        details: err?.response?.data ?? String(err),
      });
      return;
    }
  }
}

function reminderLogSafe(message: string, obj: any) {
  try {
    console.log(message, obj);
  } catch {
    console.log(message);
  }
}
