// src/presentation/http/controllers/InstagramAuthController.ts
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

// ✅ helpers extraídos (http/instagram)
import { ymd, parseYmd, listDays } from "../instagram/instagramDateUtils";
import {
  toFiniteNumber,
  mapInsightByDayRobust,
} from "../instagram/instagramInsightsMapper";
import {
  setIgLoginCookie,
  getIgLoginCookie,
  clearIgLoginCookie,
} from "../instagram/instagramCookies";
import { signState, safeParseState } from "../instagram/instagramState";
import { isInstagramTokenInvalid } from "../instagram/instagramErrors";
import {
  getFollowersSeriesFromDb,
  saveTodayFollowersSnapshot,
} from "../instagram/instagramFollowersRepository";

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

/**
 * ✅ Candidato encontrado para o usuário escolher no frontend
 * - Pode ser Business (instagram_business_account) ou Creator (connected_instagram_account)
 */
export type IgCandidate = {
  igUserId: string;
  username: string;
  accountType: string;
  facebookPageId: string;
  facebookPageName?: string;
  pageAccessToken: string;
  source: "instagram_business_account" | "connected_instagram_account";
};

/* =========================
   Auth helper
========================= */

function getAuthenticatedUserId(req: Request): string | null {
  const anyReq = req as any;

  const fromUser =
    anyReq?.user?.sub ||
    anyReq?.user?.id ||
    anyReq?.user?.userId ||
    anyReq?.userId ||
    null;

  if (typeof fromUser === "string" && fromUser.trim().length > 0)
    return fromUser.trim();
  if (typeof fromUser === "number") return String(fromUser);

  const fromHeader = req.header("x-user-id");
  if (typeof fromHeader === "string" && fromHeader.trim().length > 0)
    return fromHeader.trim();

  return null;
}

/* =========================
   Params helpers
========================= */

function parseRedirectParam(v: unknown): boolean {
  // ✅ default = true (callback do FB)
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

function safeJson(res: Response, status: number, body: any) {
  if (res.headersSent) return;
  res.status(status).json(body);
}

function safeRedirect(res: Response, status: number, url: string) {
  if (res.headersSent) return;
  res.redirect(status, url);
}

function buildFrontRedirect(opts: {
  returnTo: string;
  params: Record<string, string>;
}) {
  const frontUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const { returnTo, params } = opts;

  const safeReturnTo =
    returnTo && returnTo.startsWith("/") ? returnTo : "/settings";
  const base = `${frontUrl}${safeReturnTo}`;
  const qs = new URLSearchParams(params);

  return `${base}${base.includes("?") ? "&" : "?"}${qs.toString()}`;
}

function reminderLogSafe(message: string, obj?: any) {
  try {
    if (obj !== undefined) console.log(message, obj);
    else console.log(message);
  } catch {
    // noop
  }
}

/* =========================
   ✅ Persistência de candidates (resolve 400 após refresh/restart)
========================= */

function normalizeCandidate(c: any): IgCandidate {
  return {
    igUserId: String(c?.igUserId ?? "").trim(),
    username: String(c?.username ?? "").trim(),
    accountType: String(c?.accountType ?? "").trim(),
    facebookPageId: String(c?.facebookPageId ?? "").trim(),
    facebookPageName:
      c?.facebookPageName != null ? String(c.facebookPageName) : undefined,
    pageAccessToken: String(c?.pageAccessToken ?? "").trim(),
    source:
      c?.source === "connected_instagram_account"
        ? "connected_instagram_account"
        : "instagram_business_account",
  };
}

async function persistCandidatesToDb(opts: {
  userId: string;
  selectionId: string;
  candidates: any[];
}) {
  const { userId, selectionId } = opts;
  const candidates = Array.isArray(opts.candidates) ? opts.candidates : [];

  // evita inserir lixo
  const normalized = candidates
    .map(normalizeCandidate)
    .filter(
      (c) =>
        !!c.igUserId &&
        !!c.facebookPageId &&
        !!c.pageAccessToken &&
        !!c.username
    );

  if (!selectionId || !userId || normalized.length === 0) return;

  // ✅ estratégia simples e robusta:
  // - remove registros antigos dessa selectionId
  // - reinsere os atuais
  // Isso elimina necessidade de unique/skipDuplicates.
  try {
    await prisma.instagramCandidate.deleteMany({
      where: { userId, selectionId },
    });

    await prisma.instagramCandidate.createMany({
      data: normalized.map((c) => ({
        userId,
        selectionId,

        igUserId: c.igUserId,
        username: c.username,
        accountType: c.accountType,

        facebookPageId: c.facebookPageId,
        facebookPageName: c.facebookPageName ?? null,

        pageAccessToken: c.pageAccessToken,
        source: c.source,
      })),
    });
  } catch (e: any) {
    // não derruba o fluxo se falhar persistência
    console.warn(
      "[IG] persistCandidatesToDb warning:",
      e?.message ?? e
    );
  }
}

async function readCandidatesFromDb(opts: {
  userId: string;
  selectionId: string;
}): Promise<IgCandidate[]> {
  const { userId, selectionId } = opts;

  try {
    const rows = await prisma.instagramCandidate.findMany({
      where: { userId, selectionId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return rows
      .map((r: any) =>
        normalizeCandidate({
          igUserId: r?.igUserId,
          username: r?.username,
          accountType: r?.accountType,
          facebookPageId: r?.facebookPageId,
          facebookPageName: r?.facebookPageName,
          pageAccessToken: r?.pageAccessToken,
          source: r?.source,
        })
      )
      .filter((c) => !!c.igUserId && !!c.facebookPageId && !!c.pageAccessToken);
  } catch (e: any) {
    console.warn("[IG] readCandidatesFromDb warning:", e?.message ?? e);
    return [];
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
    const mediaRes: AxiosResponse<IgMediaResponse> =
      await graph.get<IgMediaResponse>(`/${igUserId}/media`, {
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
      const insightsRes: AxiosResponse<IgInsightsResponse> =
        await graph.get<IgInsightsResponse>(`/${m.id}/insights`, {
          params: {
            metric: "shares,saved",
            access_token: accessToken,
          },
        });

      const arr = insightsRes.data?.data ?? [];

      const pickValue = (row: IgInsightRow): number => {
        const v =
          row?.values?.[0]?.value ?? row?.total_value ?? row?.value ?? row ?? 0;
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
  instagramAccountId: string; // ✅ filtra por conta
  from: string;
  to: string;
  followersBase: number;
}) {
  const { userId, instagramAccountId, from, to, followersBase } = opts;

  const fromDate = parseYmd(from);
  const toDate = new Date(parseYmd(to).getTime() + 86399999);

  const posts = await prisma.instagramPost.findMany({
    where: {
      userId,
      instagramAccountId,
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
      const m = (p as any).metrics?.[0];

      const likes = toFiniteNumber((p as any).likeCount);
      const comments = toFiniteNumber((p as any).commentsCount);

      const reach = toFiniteNumber(m?.reach);
      const shares = toFiniteNumber(m?.shares);
      const saved = toFiniteNumber(m?.saves);
      const totalInteractions =
        toFiniteNumber(m?.totalInteractions) || likes + comments + shares + saved;

      const plays = toFiniteNumber(m?.plays);
      const videoViews = toFiniteNumber(m?.videoViews);
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
    .sort(
      (a, b) => (b.insights?.totalInteractions ?? 0) - (a.insights?.totalInteractions ?? 0)
    )
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

  const mediaRes: AxiosResponse<IgMediaResponse> =
    await graph.get<IgMediaResponse>(`/${igUserId}/media`, {
      params: {
        fields:
          "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
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
        const insightsRes: AxiosResponse<IgInsightsResponse> =
          await graph.get<IgInsightsResponse>(`/${it.id}/insights`, {
            params: {
              metric: "plays,video_views,reach,total_interactions,shares,saved",
              access_token: accessToken,
            },
          });

        const arr = insightsRes.data?.data ?? [];

        const pickValue = (row: IgInsightRow): number | null => {
          const v =
            row?.values?.[0]?.value ?? row?.total_value ?? row?.value ?? row ?? null;
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

async function enqueueInstagramBackfill(opts: {
  userId: string;
  instagramAccountId: string;
}) {
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
  const v = (req.query.instagramAccountId ?? req.query.accountId) as any;
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

async function getInstagramAccountForRequest(
  userId: string,
  instagramAccountId?: string | null
) {
  if (instagramAccountId) {
    return prisma.instagramAccount.findFirst({
      where: { id: instagramAccountId, userId },
      orderBy: { updatedAt: "desc" },
    });
  }

  // ✅ preferência: conta conectada mais recente
  const connected = await prisma.instagramAccount.findFirst({
    where: { userId, isConnected: true },
    orderBy: { updatedAt: "desc" },
  });
  if (connected) return connected;

  // fallback: última atualizada
  return prisma.instagramAccount.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
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
      const result = (await this.completeLogin.execute(code, state ?? "", userId)) as
        | InstagramLoginReauthRequired
        | InstagramLoginChooseRequired;

      if (result?.status === "reauth_required") {
        const missing = Array.isArray((result as any)?.missingPermissions)
          ? (result as any).missingPermissions
          : [];

        reminderLogSafe("[IG] reauth required -> rerequest", {
          userId,
          missingPermissions: missing,
        });

        const urlFromUseCase = (result as any)?.loginUrl
          ? String((result as any).loginUrl)
          : "";
        const rerequestUrl = urlFromUseCase || this.authService.buildLoginUrl(state, true);

        clearIgLoginCookie(res);

        if (!redirect) {
          safeJson(res, 200, {
            status: "reauth_required",
            missingPermissions: missing,
            url: rerequestUrl,
            returnTo,
          });
          return;
        }

        safeRedirect(res, 302, rerequestUrl);
        return;
      }

      if (result?.status === "choose_required") {
        clearIgLoginCookie(res);

        const selectionId = String((result as any).selectionId);
        const candidates = Array.isArray((result as any).candidates)
          ? (result as any).candidates
          : [];

        reminderLogSafe("[IG] choose_required", {
          userId,
          selectionId,
          candidatesCount: candidates.length,
        });

        // ✅ NOVO: persistir candidates no DB para sobreviver refresh/restart
        await persistCandidatesToDb({ userId, selectionId, candidates });

        if (!redirect) {
          safeJson(res, 200, {
            status: "choose_required",
            selectionId,
            candidates,
            returnTo,
          });
          return;
        }

        const redirectUrl = buildFrontRedirect({
          returnTo,
          params: {
            instagram: "choose",
            selectionId,
          },
        });

        safeRedirect(res, 302, redirectUrl);
        return;
      }

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

      clearIgLoginCookie(res);

      const details = err?.response?.data ?? (err?.message ? String(err.message) : String(err));
      const msg = "Erro ao completar login do Instagram";

      if (!redirect) {
        safeJson(res, 500, { message: msg, details });
        return;
      }

      const redirectUrl = buildFrontRedirect({
        returnTo,
        params: { instagram: "error", message: msg },
      });

      safeRedirect(res, 302, redirectUrl);
      return;
    }
  }

  /**
   * ✅ GET /api/instagram/candidates?selectionId=...
   * ✅ FIX: não depende mais apenas de memória/cache do UseCase.
   * - tenta UseCase (fluxo normal)
   * - se falhar/expirou, busca no DB (persistido no callback)
   */
  async candidates(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      safeJson(res, 401, { message: "Não autenticado" });
      return;
    }

    const selectionId = String(req.query.selectionId ?? "").trim();
    if (!selectionId) {
      safeJson(res, 400, { message: "selectionId é obrigatório" });
      return;
    }

    // 1) tenta via UseCase (pode falhar se reiniciou/expirou)
    try {
      const candidates = await this.completeLogin.getCandidates({ selectionId, userId });

      // ✅ garante persistência mesmo se candidates só existiam em memória
      await persistCandidatesToDb({ userId, selectionId, candidates });

      safeJson(res, 200, { selectionId, candidates });
      return;
    } catch (err: any) {
      // 2) fallback DB
      const fromDb = await readCandidatesFromDb({ userId, selectionId });
      if (fromDb.length > 0) {
        safeJson(res, 200, { selectionId, candidates: fromDb });
        return;
      }

      const msg =
        err?.message ? String(err.message) : "Erro ao listar candidates";
      safeJson(res, 400, {
        message: msg,
        reason: "selection_expired_or_not_found",
      });
      return;
    }
  }

  /**
   * ✅ POST /api/instagram/choose
   * ✅ FIX TS: facebookPageId sempre string
   */
  async choose(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      safeJson(res, 401, { message: "Não autenticado" });
      return;
    }

    const selectionId = String((req.body as any)?.selectionId ?? "").trim();
    const igUserId = String((req.body as any)?.igUserId ?? "").trim();
    const facebookPageIdRaw = (req.body as any)?.facebookPageId;
    const facebookPageId =
      facebookPageIdRaw != null ? String(facebookPageIdRaw).trim() : "";

    if (!selectionId) {
      safeJson(res, 400, { message: "selectionId é obrigatório" });
      return;
    }
    if (!igUserId) {
      safeJson(res, 400, { message: "igUserId é obrigatório" });
      return;
    }

    // ✅ IMPORTANT: o UseCase exige facebookPageId: string (obrigatório)
    const selections = [
      {
        igUserId,
        facebookPageId: facebookPageId || "",
      },
    ];

    try {
      const results = await this.completeLogin.confirmSelection({
        selectionId,
        userId,
        selections,
      });

      const connectedAccountIds: string[] = [];

      for (const r of results) {
        const ig = String((r as any).igUserId);
        const fb = String((r as any).facebookPageId ?? "").trim();

        const acc = await prisma.instagramAccount.findFirst({
          where: {
            userId,
            instagramId: ig,
            ...(fb ? { facebookPageId: fb } : {}),
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });

        if (acc?.id) connectedAccountIds.push(acc.id);
      }

      for (const id of connectedAccountIds) {
        await enqueueInstagramBackfill({ userId, instagramAccountId: id });
      }

      safeJson(res, 200, {
        status: "ok",
        accounts: results,
        instagramAccountIds: connectedAccountIds,
      });
      return;
    } catch (err: any) {
      console.error("[IG] choose error:", err?.response?.data ?? err);
      safeJson(res, 500, {
        message: "Erro ao selecionar conta do Instagram",
        details: err?.response?.data ?? String(err),
      });
      return;
    }
  }

  /**
   * ✅ POST /api/instagram/confirm
   * ✅ FIX TS: normaliza selections para sempre ter facebookPageId: string
   */
  async confirm(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      safeJson(res, 401, { message: "Não autenticado" });
      return;
    }

    const selectionId = String((req.body as any)?.selectionId ?? "").trim();
    const returnToRaw = String((req.body as any)?.returnTo ?? "/settings");
    const redirect = parseRedirectParam((req.body as any)?.redirect);
    const returnTo = returnToRaw.startsWith("/") ? returnToRaw : "/settings";

    if (!selectionId) {
      safeJson(res, 400, { message: "selectionId é obrigatório" });
      return;
    }

    // ✅ normaliza para o tipo do usecase (facebookPageId obrigatório)
    const selections = Array.isArray((req.body as any)?.selections)
      ? (req.body as any).selections.map((s: any) => ({
          igUserId: String(s?.igUserId ?? "").trim(),
          facebookPageId: String(s?.facebookPageId ?? "").trim(), // ✅ sempre string
        }))
      : [];

    if (!Array.isArray(selections) || selections.length === 0) {
      safeJson(res, 400, { message: "Selecione ao menos uma conta" });
      return;
    }

    if (selections.some((s: any) => !s.igUserId)) {
      safeJson(res, 400, { message: "igUserId é obrigatório em todas as seleções" });
      return;
    }

    try {
      const results = await this.completeLogin.confirmSelection({
        selectionId,
        userId,
        selections,
      });

      const connectedAccountIds: string[] = [];

      for (const r of results) {
        const igUserId = String((r as any).igUserId);
        const facebookPageId = String((r as any).facebookPageId ?? "").trim();

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
        await enqueueInstagramBackfill({ userId, instagramAccountId: id });
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

    const row =
      (await prisma.instagramAccount.findFirst({
        where: { userId, isConnected: true },
        orderBy: { updatedAt: "desc" },
      })) ||
      (await prisma.instagramAccount.findFirst({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      }));

    const connected =
      !!row?.isConnected && (!!(row as any)?.pageAccessToken || !!(row as any)?.accessToken);

    reminderLogSafe("[IG] status", {
      userId,
      hasRow: !!row,
      instagramId: (row as any)?.instagramId ?? null,
      instagramAccountId: (row as any)?.id ?? null,
      isConnected: (row as any)?.isConnected ?? false,
      hasAccessToken: !!(row as any)?.accessToken,
      hasPageAccessToken: !!(row as any)?.pageAccessToken,
      computedConnected: connected,
    });

    safeJson(res, 200, {
      connected,
      instagramAccountId: (row as any)?.id ?? null,
      igUserId: (row as any)?.instagramId ?? null,
      username: (row as any)?.instagramUserName ?? null,
      accountType: (row as any)?.accountType ?? null,
      expiresAt: (row as any)?.accessTokenExpiresAt ?? null,
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

    if (
      !row ||
      !(row as any).isConnected ||
      !(row as any).instagramId ||
      (!(row as any).pageAccessToken && !(row as any).accessToken)
    ) {
      safeJson(res, 409, { message: "Instagram não conectado" });
      return;
    }

    const igUserId = String((row as any).instagramId);
    const accessToken = (row as any).pageAccessToken ?? (row as any).accessToken!;
    const graphBaseUrl =
      process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";

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
      const username = String(profileRes.data?.username ?? (row as any).instagramUserName ?? "");

      await saveTodayFollowersSnapshot({
        userId,
        igUserId,
        followers: currentFollowers,
      });

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

      const followersRaw = await getFollowersSeriesFromDb({
        userId,
        igUserId,
        from,
        to,
      });

      const followersByDay: Record<string, number> = { ...followersRaw };
      const hasHistory = Object.keys(followersRaw).length > 0;

      let last = hasHistory ? followersByDay[days[0]] ?? currentFollowers : currentFollowers;

      for (const d of days) {
        if (followersByDay[d] == null) followersByDay[d] = last;
        else last = followersByDay[d];
      }

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

        return {
          date: day,
          followers,
          reach,
          profileViews,
          totalInteractions,
          engagementRate,
        };
      });

      const totalReach = timeseries.reduce((acc, t) => acc + (t.reach ?? 0), 0);
      const totalInteractions = timeseries.reduce(
        (acc, t) => acc + (t.totalInteractions ?? 0),
        0
      );
      const avgEngagementRate =
        timeseries.length > 0
          ? timeseries.reduce((acc, t) => acc + (t.engagementRate ?? 0), 0) /
            timeseries.length
          : 0;

      const followersKpi = timeseries[timeseries.length - 1]?.followers ?? currentFollowers;

      let topContent: any[] = [];
      try {
        const dbTop = await fetchTopContentFromDb({
          userId,
          instagramAccountId: (row as any).id,
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
        account: { igUserId, username, instagramAccountId: (row as any).id },
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
          where: { id: (row as any).id },
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
