// src/application/services/analytics/ensurePostsAndMetricsInRange.ts

import axios from "axios";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { AxiosInstagramGraphClient } from "../../../infrastructure/instagram/clients/AxiosInstagramGraphClient";

/* ======================================================
   Helpers (robustos)
   ====================================================== */

function s(v: any): string {
  return String(v ?? "").trim();
}

function safeNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function safeInt(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function optionalNumber(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function assertYmd(ymd: string, label: string): string {
  const v = s(ymd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error(
      `[ensurePostsAndMetricsInRange] ${label} inválido: "${ymd}" (esperado YYYY-MM-DD)`
    );
  }
  return v;
}

/**
 * ✅ Constrói Date UTC sem depender do parser do JS.
 */
function ymdToUtcDateStart(ymd: string): Date {
  const v = assertYmd(ymd, "date");
  const [yy, mm, dd] = v.split("-").map((x) => Number(x));
  return new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0));
}

function ymdToUtcDateEnd(ymd: string): Date {
  const v = assertYmd(ymd, "date");
  const [yy, mm, dd] = v.split("-").map((x) => Number(x));
  return new Date(Date.UTC(yy, mm - 1, dd, 23, 59, 59, 999));
}

function ensureDate(d: any, label: string): Date {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error(
      `[ensurePostsAndMetricsInRange] ${label} inválido (esperado Date): ${String(d)}`
    );
  }
  return d;
}

function toUnixSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function utcYmdFromDate(d: Date): string {
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function listDaysInclusive(fromYmd: string, toYmd: string): string[] {
  const from = assertYmd(fromYmd, "from");
  const to = assertYmd(toYmd, "to");

  const start = ymdToUtcDateStart(from);
  const end = ymdToUtcDateStart(to);

  if (start.getTime() > end.getTime()) {
    throw new Error(
      `[ensurePostsAndMetricsInRange] Range inválido: from(${from}) > to(${to})`
    );
  }

  const out: string[] = [];
  let cur = start;

  while (cur.getTime() <= end.getTime()) {
    out.push(utcYmdFromDate(cur));
    cur = new Date(
      Date.UTC(
        cur.getUTCFullYear(),
        cur.getUTCMonth(),
        cur.getUTCDate() + 1,
        0,
        0,
        0,
        0
      )
    );
  }

  return out;
}

/* ======================================================
   Types
   ====================================================== */

export type EnsureRangeProgress = {
  importedPosts?: number; // worker espera esse nome
  processedMetrics?: number; // worker espera esse nome

  ensuredPosts?: number;
  ensuredMetrics?: number;
  processedPostsMetrics?: number;

  message?: string;
};

export type EnsurePostsAndMetricsInRangeInput = {
  userId: string;
  instagramAccountId: string;
  igUserId: string;
  accessToken: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  onProgress?: (p: EnsureRangeProgress) => void;
};

/* ======================================================
   Graph helpers
   ====================================================== */

const GRAPH_VERSION = process.env.FB_GRAPH_VERSION || "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function graphGet<T = any>(
  path: string,
  accessToken: string,
  params: Record<string, any> = {}
): Promise<T> {
  const url = `${GRAPH_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await axios.get(url, {
    params: { ...params, access_token: accessToken },
    timeout: 60_000,
  });
  return res.data as T;
}

/**
 * ✅ Busca followers_count atual do perfil (usado só pra seed quando não existe histórico)
 */
async function fetchFollowersCountNow(opts: {
  igUserId: string;
  accessToken: string;
}): Promise<number> {
  const { igUserId, accessToken } = opts;

  try {
    const res = await graphGet<{ followers_count?: number }>(
      `/${igUserId}`,
      accessToken,
      { fields: "followers_count" }
    );

    const v = safeInt(res?.followers_count ?? 0);
    return v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

type IgMediaEdge = {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string; // ISO
};

type IgMediaListResponse = {
  data: IgMediaEdge[];
  paging?: { next?: string };
};

async function fetchAllMediaInRange(opts: {
  igUserId: string;
  accessToken: string;
  sinceUnix: number;
  untilUnix: number;
}): Promise<IgMediaEdge[]> {
  const { igUserId, accessToken, sinceUnix, untilUnix } = opts;

  const fields =
    "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";

  let out: IgMediaEdge[] = [];
  let nextUrl: string | null = null;

  let page = await graphGet<IgMediaListResponse>(`/${igUserId}/media`, accessToken, {
    fields,
    limit: 50,
    since: sinceUnix,
    until: untilUnix,
  });

  out = out.concat(page.data ?? []);
  nextUrl = page.paging?.next ?? null;

  while (nextUrl) {
    const res = await axios.get(nextUrl, { timeout: 60_000 });
    const data = res.data as IgMediaListResponse;

    out = out.concat(data.data ?? []);
    nextUrl = data.paging?.next ?? null;
  }

  return out;
}

type InsightValue = { value: number; end_time?: string };
type InsightItem = {
  name: string;
  period?: string;
  values?: InsightValue[];
  title?: string;
};
type InsightsResponse = { data: InsightItem[] };

function pickInsightsByDay(
  resp: InsightsResponse
): Record<string, Record<string, number>> {
  const byDay: Record<string, Record<string, number>> = {};

  for (const metric of resp.data ?? []) {
    const name = metric.name;
    const values = metric.values ?? [];
    for (const v of values) {
      const end = v.end_time;
      if (!end) continue;
      const d = new Date(end);
      const ymd = utcYmdFromDate(d);
      byDay[ymd] = byDay[ymd] || {};
      byDay[ymd][name] = safeNum(v.value);
    }
  }

  return byDay;
}

async function fetchMediaInsightsDaily(opts: {
  mediaId: string;
  accessToken: string;
  sinceUnix: number;
  untilUnix: number;
}): Promise<Record<string, Record<string, number>>> {
  const { mediaId, accessToken, sinceUnix, untilUnix } = opts;

  const metricCandidates = [
    "reach",
    "impressions",
    "saved",
    "comments",
    "likes",
    "shares",
    "plays",
    "video_views",
  ];

  const chunks: string[][] = [
    ["reach", "impressions"],
    ["likes", "comments", "saved", "shares"],
    ["plays", "video_views"],
  ];

  const merged: Record<string, Record<string, number>> = {};

  for (const metrics of chunks) {
    try {
      const resp = await graphGet<InsightsResponse>(
        `/${mediaId}/insights`,
        accessToken,
        {
          metric: metrics.join(","),
          period: "day",
          since: sinceUnix,
          until: untilUnix,
        }
      );

      const byDay = pickInsightsByDay(resp);
      for (const day of Object.keys(byDay)) {
        merged[day] = merged[day] || {};
        for (const k of Object.keys(byDay[day])) {
          merged[day][k] = safeNum(byDay[day][k]);
        }
      }
    } catch {
      // ignora lote que não existe pra esse tipo
    }
  }

  for (const day of Object.keys(merged)) {
    for (const m of metricCandidates) {
      if (merged[day][m] === undefined) merged[day][m] = 0;
    }
  }

  return merged;
}

async function fetchAccountInsightsDaily(opts: {
  igUserId: string;
  accessToken: string;
  sinceUnix: number;
  untilUnix: number;
}): Promise<Record<string, Record<string, number>>> {
  const { igUserId, accessToken, sinceUnix, untilUnix } = opts;

  const metrics = ["profile_views", "reach"];

  try {
    const resp = await graphGet<InsightsResponse>(
      `/${igUserId}/insights`,
      accessToken,
      {
        metric: metrics.join(","),
        period: "day",
        since: sinceUnix,
        until: untilUnix,
      }
    );
    return pickInsightsByDay(resp);
  } catch {
    return {};
  }
}

/* ======================================================
   Main (fluxo completo)
   ====================================================== */

export async function ensurePostsAndMetricsInRange(
  opts: EnsurePostsAndMetricsInRangeInput
): Promise<{ ensuredPosts: number; ensuredMetrics: number }> {
  const userId = s(opts.userId);
  const instagramAccountId = s(opts.instagramAccountId);
  const igUserId = s(opts.igUserId);
  const accessToken = s(opts.accessToken);

  const from = assertYmd(opts.from, "from");
  const to = assertYmd(opts.to, "to");

  const onProgress = opts.onProgress;

  // compat (não usado diretamente aqui)
  const igClient = new AxiosInstagramGraphClient();
  void igClient;

  const days = listDaysInclusive(from, to);

  // ✅ SEMPRE Date (UTC)
  const fromStart = ensureDate(ymdToUtcDateStart(from), "fromStart");
  const toEnd = ensureDate(ymdToUtcDateEnd(to), "toEnd");

  const sinceUnix = toUnixSeconds(fromStart);
  const untilUnix = toUnixSeconds(toEnd);

  onProgress?.({
    message: `Ensuring range ${from}..${to} (${days.length} dias)`,
  });

  /* ======================================================
     1) DAILY METRICS (instagramAccountDailyMetrics)
     ====================================================== */

  // pega último followers antes do range (pra forward-fill)
  let lastBefore = await prisma.instagramAccountDailyMetrics.findFirst({
    where: {
      instagramAccountId,
      userId,
      day: { lt: fromStart }, // ✅ Date
    },
    orderBy: { day: "desc" },
    select: { followers: true },
  });

  // ✅ SEED followers se não existir histórico (ou vier 0)
  if (!lastBefore?.followers || safeInt(lastBefore.followers) <= 0) {
    const seedFollowers = await fetchFollowersCountNow({ igUserId, accessToken });

    if (seedFollowers > 0) {
      const seedDay = new Date(fromStart.getTime() - 86400000); // from - 1 dia

      await prisma.instagramAccountDailyMetrics.upsert({
        where: {
          instagramAccountId_day: {
            instagramAccountId,
            day: seedDay,
          },
        },
        create: {
          userId,
          instagramAccountId,
          day: seedDay,
          followers: seedFollowers,
          profileViewsTotal: 0,
          reach: 0,
          totalInteractions: 0,
        } as any,
        update: {
          followers: seedFollowers,
        } as any,
      });

      // atualiza pra o forward-fill começar certo
      lastBefore = { followers: seedFollowers } as any;
    }
  }

  let lastFollowers = safeInt(lastBefore?.followers ?? 0);

  const existing = await prisma.instagramAccountDailyMetrics.findMany({
    where: {
      instagramAccountId,
      userId,
      day: { gte: fromStart, lte: toEnd }, // ✅ Date
    },
    orderBy: { day: "asc" },
    select: { day: true, followers: true },
  });

  const followersByDay = new Map<string, number>();
  for (const row of existing) {
    followersByDay.set(utcYmdFromDate(row.day), safeInt(row.followers ?? 0));
  }

  let ensuredMetrics = 0;

  for (const dayYmd of days) {
    const dayDate = ensureDate(ymdToUtcDateStart(dayYmd), `dayDate(${dayYmd})`);

    // forward-fill
    if (followersByDay.has(dayYmd)) {
      const v = followersByDay.get(dayYmd)!;
      if (Number.isFinite(v) && v > 0) lastFollowers = v;
    }

    await prisma.instagramAccountDailyMetrics.upsert({
      where: {
        instagramAccountId_day: {
          instagramAccountId,
          day: dayDate,
        },
      },
      create: {
        userId,
        instagramAccountId,
        day: dayDate,
        followers: lastFollowers,
        profileViewsTotal: 0,
        reach: 0,
        totalInteractions: 0,
      } as any,
      update: {
        followers: lastFollowers,
      } as any,
    });

    ensuredMetrics++;
    if (ensuredMetrics % 5 === 0) {
      onProgress?.({
        ensuredMetrics,
        processedMetrics: ensuredMetrics,
      });
    }
  }

  /* ======================================================
     2) POSTS (instagramPost)
     ====================================================== */

  onProgress?.({ message: "Buscando posts do período (Graph API)..." });

  const apiMedia = await fetchAllMediaInRange({
    igUserId,
    accessToken,
    sinceUnix,
    untilUnix,
  });

  let ensuredPosts = 0;

  for (const m of apiMedia) {
    const igMediaId = s(m.id);
    if (!igMediaId) continue;

    const publishedAt =
      m.timestamp && !Number.isNaN(new Date(m.timestamp).getTime())
        ? new Date(m.timestamp)
        : null;

    // corta fora do range (se vier timestamp)
    if (publishedAt) {
      if (publishedAt.getTime() < fromStart.getTime()) continue;
      if (publishedAt.getTime() > toEnd.getTime()) continue;
    }

    const existingPost = await prisma.instagramPost.findFirst({
      where: {
        userId,
        instagramAccountId,
        igMediaId,
      } as any,
      select: { id: true },
    });

    const postData = {
      caption: m.caption ?? null,
      mediaType: m.media_type ?? null,
      thumb: m.thumbnail_url ?? m.media_url ?? null,
    };

    if (existingPost?.id) {
      await prisma.instagramPost.update({
        where: { id: existingPost.id },
        data: {
          ...postData,
          ...(publishedAt ? { publishedAt } : {}),
        } as any,
      });
    } else {
      await prisma.instagramPost.create({
        data: {
          userId,
          instagramAccountId,
          igMediaId,
          ...postData,
          publishedAt: publishedAt ?? fromStart,
        } as any,
      });
    }

    ensuredPosts++;
    if (ensuredPosts % 10 === 0) {
      onProgress?.({
        ensuredPosts,
        importedPosts: ensuredPosts,
      });
    }
  }

  const ensuredDbPosts = await prisma.instagramPost.findMany({
    where: {
      userId,
      instagramAccountId,
      publishedAt: { gte: fromStart, lte: toEnd },
    } as any,
    select: {
      id: true,
      igMediaId: true,
      publishedAt: true,
    } as any,
  });

  /* ======================================================
     3) MÉTRICAS DIÁRIAS POR POST (instagramPostMetric)
     ====================================================== */

  onProgress?.({ message: "Buscando insights diários dos posts..." });

  const agg: Record<
    string,
    { reach: number; likes: number; comments: number; saves: number; shares: number }
  > = {};

  let processedPostsMetrics = 0;

  for (const post of ensuredDbPosts as any[]) {
    const igMediaId = s(post.igMediaId);
    const postId = s(post.id);
    if (!igMediaId || !postId) continue;

    const insightsByDay = await fetchMediaInsightsDaily({
      mediaId: igMediaId,
      accessToken,
      sinceUnix,
      untilUnix,
    });

    for (const dayYmd of days) {
      const dayDate = ensureDate(
        ymdToUtcDateStart(dayYmd),
        `postDayDate(${dayYmd})`
      );

      const m = insightsByDay[dayYmd] || {};

      const reach = safeInt(m.reach ?? 0);
      const likes = safeInt(m.likes ?? 0);
      const comments = safeInt(m.comments ?? 0);
      const saves = safeInt(m.saved ?? 0);
      const shares = safeInt(m.shares ?? 0);

      const totalInteractions = likes + comments + saves + shares;

      const upd = await prisma.instagramPostMetric.updateMany({
        where: {
          postId,
          pulledAt: dayDate,
        },
        data: {
          reach,
          likes,
          comments,
          saves,
          shares,
          totalInteractions,
        },
      });

      if ((upd?.count ?? 0) === 0) {
        await prisma.instagramPostMetric.create({
          data: {
            postId,
            pulledAt: dayDate,
            reach,
            likes,
            comments,
            saves,
            shares,
            totalInteractions,
          },
        });
      }

      agg[dayYmd] =
        agg[dayYmd] || ({ reach: 0, likes: 0, comments: 0, saves: 0, shares: 0 });

      agg[dayYmd].reach += reach;
      agg[dayYmd].likes += likes;
      agg[dayYmd].comments += comments;
      agg[dayYmd].saves += saves;
      agg[dayYmd].shares += shares;
    }

    processedPostsMetrics++;
    if (processedPostsMetrics % 5 === 0) {
      onProgress?.({ processedPostsMetrics });
    }
  }

  /* ======================================================
     4) ACCOUNT INSIGHTS + UPDATE DailyMetrics
     ====================================================== */

  onProgress?.({
    message: "Atualizando métricas diárias agregadas (account)...",
  });

  const accountInsights = await fetchAccountInsightsDaily({
    igUserId,
    accessToken,
    sinceUnix,
    untilUnix,
  });

  for (const dayYmd of days) {
    const dayDate = ensureDate(
      ymdToUtcDateStart(dayYmd),
      `accDayDate(${dayYmd})`
    );

    const postAgg =
      agg[dayYmd] || ({ reach: 0, likes: 0, comments: 0, saves: 0, shares: 0 });

    const acc = accountInsights[dayYmd] || {};
    const profileViewsTotal = safeInt(acc.profile_views ?? 0);

    const reachFromAccount = optionalNumber(acc.reach);
    const reach =
      reachFromAccount !== undefined
        ? safeInt(reachFromAccount)
        : safeInt(postAgg.reach);

    const totalInteractions =
      safeInt(postAgg.likes) +
      safeInt(postAgg.comments) +
      safeInt(postAgg.saves) +
      safeInt(postAgg.shares);

    await prisma.instagramAccountDailyMetrics.update({
      where: {
        instagramAccountId_day: {
          instagramAccountId,
          day: dayDate,
        },
      },
      data: {
        profileViewsTotal,
        reach,
        totalInteractions,
      } as any,
    });
  }

  onProgress?.({
    message: "Ensure finalizado ✅",
    ensuredPosts,
    ensuredMetrics,
    importedPosts: ensuredPosts,
    processedMetrics: ensuredMetrics,
    processedPostsMetrics,
  });

  return { ensuredPosts, ensuredMetrics };
}
