import type { Request, Response } from "express";
import { prisma } from "../../../../infrastructure/db/prismaClient";
import { AxiosInstagramGraphClient } from "../../../../infrastructure/instagram/clients/AxiosInstagramGraphClient";

function s(v: any): string {
  return String(v ?? "").trim();
}

function getUserId(req: any): string | null {
  return (
    req?.user?.sub ||
    req?.user?.id ||
    req?.user?.userId ||
    req?.userId ||
    req?.header?.("x-user-id") ||
    null
  );
}

function isValidYmd(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function parseYmdToUtcStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}
function parseYmdToUtcEnd(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999Z`);
}

function clampDaysRange(from: string, to: string, maxDays: number) {
  const start = parseYmdToUtcStart(from).getTime();
  const end = parseYmdToUtcStart(to).getTime();
  const days = Math.floor((end - start) / 86400000) + 1;
  if (days <= maxDays) return { from, to, days };

  const newStartMs = end - (maxDays - 1) * 86400000;
  const d = new Date(newStartMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return { from: `${y}-${m}-${da}`, to, days: maxDays };
}

function listDays(from: string, to: string): string[] {
  const start = parseYmdToUtcStart(from).getTime();
  const end = parseYmdToUtcStart(to).getTime();
  const out: string[] = [];
  for (let ms = start; ms <= end; ms += 86400000) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${da}`);
  }
  return out;
}

function formatPostDateLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const dd = parts.find((p) => p.type === "day")?.value ?? "00";
  const mm = parts.find((p) => p.type === "month")?.value ?? "00";
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mi = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${dd}/${mm} às ${hh}:${mi}`;
}

function dayKeyPtBr(
  date: Date,
): "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom" {
  const wd = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(date);

  if (wd.startsWith("seg")) return "seg";
  if (wd.startsWith("ter")) return "ter";
  if (wd.startsWith("qua")) return "qua";
  if (wd.startsWith("qui")) return "qui";
  if (wd.startsWith("sex")) return "sex";
  if (wd.startsWith("sáb") || wd.startsWith("sab")) return "sab";
  return "dom";
}

function hourLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  return `${hh}:00`;
}

function toPostType(
  mediaType: string | null | undefined,
): "reel" | "feed" | "carousel" {
  const t = String(mediaType ?? "").toUpperCase();
  if (t === "REELS") return "reel";
  if (t === "CAROUSEL_ALBUM") return "carousel";
  return "feed";
}

function safeNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date && Number.isFinite(v.getTime())) return v;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function ymdUtcKey(d: Date): string {
  // ✅ chave consistente (UTC) — resolve seu “01..30 não aparece”
  return d.toISOString().slice(0, 10);
}

async function resolveInstagramAccount(userId: string, requestedId?: string) {
  const reqId = s(requestedId);

  if (reqId) {
    const acc = await prisma.instagramAccount.findFirst({
      where: {
        id: reqId,
        userId,
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      select: {
        id: true,
        igUserId: true,
        pageAccessToken: true,
        accessToken: true,
      },
    });
    if (acc) return acc;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeInstagramAccountId: true },
  });

  if (user?.activeInstagramAccountId) {
    const acc = await prisma.instagramAccount.findFirst({
      where: {
        id: user.activeInstagramAccountId,
        userId,
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      select: {
        id: true,
        igUserId: true,
        pageAccessToken: true,
        accessToken: true,
      },
    });
    if (acc) return acc;
  }

  return prisma.instagramAccount.findFirst({
    where: {
      userId,
      isConnected: true,
      OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      igUserId: true,
      pageAccessToken: true,
      accessToken: true,
    },
  });
}

/**
 * AxiosInstagramGraphClient retorna media em camelCase:
 * - mediaType, mediaUrl, thumbnailUrl, likeCount, commentsCount, timestamp
 */
async function ensurePostsAndMetricsInRange(opts: {
  userId: string;
  instagramAccountId: string;
  igUserId: string;
  accessToken: string;
  from: string;
  to: string;
  maxPosts?: number;
  forceMetrics?: boolean;
}) {
  const {
    userId,
    instagramAccountId,
    igUserId,
    accessToken,
    from,
    to,
    forceMetrics,
  } = opts;

  const maxPosts = Math.max(
    50,
    Math.min(800, Number(opts.maxPosts ?? 500) || 500),
  );

  const fromMs = parseYmdToUtcStart(from).getTime();
  const toMs = parseYmdToUtcEnd(to).getTime();

  const igClient = new AxiosInstagramGraphClient();

  const items: any[] = [];
  let after: string | undefined;
  let pages = 0;
  const maxPages = 25;

  while (pages < maxPages && items.length < maxPosts) {
    pages++;

    const out = await igClient.getRecentMediaPaged({
      igUserId,
      accessToken,
      limit: 50,
      after,
      timeoutMs: 15000,
    });

    const rows = Array.isArray(out?.data) ? out.data : [];
    if (!rows.length) break;

    let shouldStop = false;

    for (const m of rows) {
      const ts = toDate(m?.timestamp);
      if (!ts) continue;

      const tsMs = ts.getTime();

      if (tsMs < fromMs) {
        shouldStop = true;
        break;
      }

      if (tsMs > toMs) continue;

      items.push(m);
      if (items.length >= maxPosts) break;
    }

    const nextAfter = out?.paging?.cursors?.after;
    if (!nextAfter || shouldStop) break;
    after = nextAfter;
  }

  if (!items.length) return { ensuredPosts: 0, ensuredMetrics: 0 };

  // 1) garante posts no banco
  for (const it of items) {
    const igMediaId = s(it?.id);
    if (!igMediaId) continue;

    const publishedAt = toDate(it?.timestamp);
    if (!publishedAt) continue;

    const thumb = s(it?.thumbnailUrl) || s(it?.mediaUrl) || null;

    await prisma.instagramPost.upsert({
      where: { instagramAccountId_igMediaId: { instagramAccountId, igMediaId } },
      create: {
        userId,
        instagramAccountId,
        igMediaId,
        mediaType: it?.mediaType ?? null,
        publishedAt,
        caption: it?.caption ?? null,
        permalink: it?.permalink ?? null,
        likeCount: Math.trunc(safeNum(it?.likeCount)),
        commentsCount: Math.trunc(safeNum(it?.commentsCount)),
        thumb,
      },
      update: {
        mediaType: it?.mediaType ?? null,
        publishedAt,
        caption: it?.caption ?? null,
        permalink: it?.permalink ?? null,
        likeCount: Math.trunc(safeNum(it?.likeCount)),
        commentsCount: Math.trunc(safeNum(it?.commentsCount)),
        thumb,
      },
    });
  }

  // 2) pega posts do banco no range
  const dbPosts = await prisma.instagramPost.findMany({
    where: {
      userId,
      instagramAccountId,
      publishedAt: {
        gte: parseYmdToUtcStart(from),
        lte: parseYmdToUtcEnd(to),
      },
    },
    select: {
      id: true,
      igMediaId: true,
      likeCount: true,
      commentsCount: true,
      metrics: {
        orderBy: { pulledAt: "desc" },
        take: 1,
        select: { pulledAt: true },
      },
    },
  });

  const byIgId = new Map(items.map((m) => [s(m?.id), m]));

  const toFetch = dbPosts.filter((p) => {
    if (forceMetrics) return true;

    const last = p.metrics?.[0]?.pulledAt;
    if (!last) return true;

    return Date.now() - last.getTime() > 24 * 60 * 60 * 1000;
  });

  let ensuredMetrics = 0;

  let idx = 0;
  const concurrency = Math.min(2, toFetch.length);

  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < toFetch.length) {
      const cur = toFetch[idx++];
      const igMediaId = s(cur.igMediaId);
      if (!igMediaId) continue;

      try {
        const reach = await igClient.getMediaReach({
          mediaId: igMediaId,
          accessToken,
          timeoutMs: 15000,
        });

        const m = byIgId.get(igMediaId);

        const likes = safeNum(m?.likeCount ?? cur.likeCount);
        const comments = safeNum(m?.commentsCount ?? cur.commentsCount);
        const totalInteractions = likes + comments;

        await prisma.instagramPostMetric.create({
          data: {
            postId: cur.id,
            pulledAt: new Date(),
            reach: Math.trunc(safeNum(reach)),
            likes: Math.trunc(likes),
            comments: Math.trunc(comments),
            shares: 0,
            saves: 0,
            totalInteractions: Math.trunc(totalInteractions),
          },
        });

        ensuredMetrics++;
      } catch {
        // não quebra endpoint
      }
    }
  });

  await Promise.all(workers);

  return { ensuredPosts: items.length, ensuredMetrics };
}

/* =========================================================
   Helpers de cálculo do gráfico (Growth)
========================================================= */

function movingAvg(values: number[], window: number) {
  const out: number[] = [];
  let sum = 0;
  const q: number[] = [];

  for (const x of values) {
    q.push(x);
    sum += x;
    if (q.length > window) sum -= q.shift()!;
    out.push(q.length ? sum / q.length : 0);
  }
  return out;
}

function mean(arr: number[]) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function std(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

/**
 * ✅ Análise de Crescimento (TUDO NO GRÁFICO)
 * Retorna apenas:
 * daily: [{ day, crescimentoLiquido, mediaMovel7d, visualizacoesPerfil, interacoes, novosSeguidores, anomalia }]
 */
export async function getInstagramGrowthAnalytics(req: Request, res: Response) {
  try {
    res.setHeader("Cache-Control", "no-store");

    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Não autenticado" });
    }

    const fromRaw = s(req.query.from);
    const toRaw = s(req.query.to);
    const requestedAccountId = s(req.query.instagramAccountId);

    if (!isValidYmd(fromRaw) || !isValidYmd(toRaw)) {
      return res
        .status(400)
        .json({ ok: false, message: "from/to inválidos (YYYY-MM-DD)" });
    }
    if (fromRaw > toRaw) {
      return res.status(400).json({ ok: false, message: "Range inválido" });
    }

    const clamped = clampDaysRange(fromRaw, toRaw, 30);
    const from = clamped.from;
    const to = clamped.to;

    const account = await resolveInstagramAccount(userId, requestedAccountId);
    if (!account?.id) {
      return res.json({
        ok: true,
        instagramAccountId: null,
        filters: { from, to },
        daily: listDays(from, to).map((d) => ({
          day: d,
          crescimentoLiquido: 0,
          mediaMovel7d: 0,
          visualizacoesPerfil: 0,
          interacoes: 0,
          novosSeguidores: 0,
          anomalia: false,
        })),
        message: "Nenhuma conta do Instagram conectada",
      });
    }

    const rows = await prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId,
        instagramAccountId: account.id,
        day: {
          gte: parseYmdToUtcStart(from),
          lte: parseYmdToUtcEnd(to),
        },
      },
      orderBy: { day: "asc" },
      select: {
        day: true,
        followers: true,
        profileViewsTotal: true,
        totalInteractions: true,
      },
    });

    // ✅ Map por dia usando UTC (SEM TZ) — resolve seu bug do mês “vazio”
    const byDay = new Map<
      string,
      { followers: number | null; profileViews: number; interactions: number }
    >();

    for (const r of rows) {
      const d = r.day instanceof Date ? r.day : new Date(r.day as any);
      const key = ymdUtcKey(d);

      byDay.set(key, {
        followers: r.followers ?? null,
        profileViews: Math.trunc(safeNum(r.profileViewsTotal)),
        interactions: Math.trunc(safeNum(r.totalInteractions)),
      });
    }

    const days = listDays(from, to);

    // 1) Série base
    let prevFollowers: number | null = null;

    const base = days.map((day) => {
      const v = byDay.get(day);

      const followers = v?.followers ?? null;

      const crescimentoLiquido =
        followers !== null && prevFollowers !== null
          ? Math.trunc(followers - prevFollowers)
          : 0;

      if (followers !== null) prevFollowers = followers;

      const visualizacoesPerfil = v?.profileViews ?? 0;
      const interacoes = v?.interactions ?? 0;

      // “Novos seguidores” geralmente é só o positivo
      const novosSeguidores = Math.max(0, crescimentoLiquido);

      return {
        day,
        crescimentoLiquido,
        visualizacoesPerfil,
        interacoes,
        novosSeguidores,
      };
    });

    // 2) Média móvel 7d do crescimento líquido
    const deltas = base.map((x) => x.crescimentoLiquido);
    const ma7 = movingAvg(deltas, 7).map((v) => Math.round(v * 10) / 10);

    // 3) Anomalia (z-score simples)
    const m = mean(deltas);
    const sd = std(deltas);
    const k = 2.5;

    const dailyAll = base.map((x, i) => {
      const anomalia =
        sd > 0 ? Math.abs(x.crescimentoLiquido - m) > k * sd : false;

      return {
        day: x.day,
        crescimentoLiquido: x.crescimentoLiquido,
        mediaMovel7d: ma7[i] ?? 0,
        visualizacoesPerfil: x.visualizacoesPerfil,
        interacoes: x.interacoes,
        novosSeguidores: x.novosSeguidores,
        anomalia,
      };
    });

    // ✅ Se você quiser “só dias com algo”, descomenta isso:
    // const daily = dailyAll.filter((d) =>
    //   d.crescimentoLiquido !== 0 ||
    //   d.visualizacoesPerfil !== 0 ||
    //   d.interacoes !== 0 ||
    //   d.novosSeguidores !== 0
    // );

    const daily = dailyAll;

    return res.json({
      ok: true,
      instagramAccountId: account.id,
      filters: { from, to },
      daily,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao gerar análise de crescimento",
      detail: String(error?.message ?? error),
    });
  }
}

export async function getInstagramContentAnalytics(req: Request, res: Response) {
  try {
    res.setHeader("Cache-Control", "no-store");

    const userId = getUserId(req);
    if (!userId)
      return res.status(401).json({ ok: false, message: "Não autenticado" });

    const fromRaw = s(req.query.from);
    const toRaw = s(req.query.to);
    const requestedAccountId = s(req.query.instagramAccountId);
    const limit = Math.max(5, Math.min(200, Number(req.query.limit ?? 60) || 60));

    const forceMetrics =
      s(req.query.force).toLowerCase() === "1" ||
      s(req.query.force).toLowerCase() === "true";

    if (!isValidYmd(fromRaw) || !isValidYmd(toRaw)) {
      return res
        .status(400)
        .json({ ok: false, message: "from/to inválidos (YYYY-MM-DD)" });
    }
    if (fromRaw > toRaw) {
      return res.status(400).json({ ok: false, message: "Range inválido" });
    }

    const clamped = clampDaysRange(fromRaw, toRaw, 30);
    const from = clamped.from;
    const to = clamped.to;

    const account = await resolveInstagramAccount(userId, requestedAccountId);
    if (!account?.id) {
      return res.json({
        ok: true,
        instagramAccountId: null,
        filters: { from, to, limit },
        avgViews: 0,
        items: [],
        message: "Nenhuma conta do Instagram conectada",
      });
    }

    const accessToken = s(account.pageAccessToken) || s(account.accessToken);
    if (!account.igUserId || !accessToken) {
      return res
        .status(400)
        .json({ ok: false, message: "Conta IG sem token válido" });
    }

    await ensurePostsAndMetricsInRange({
      userId,
      instagramAccountId: account.id,
      igUserId: account.igUserId,
      accessToken,
      from,
      to,
      maxPosts: 500,
      forceMetrics,
    });

    const posts = await prisma.instagramPost.findMany({
      where: {
        userId,
        instagramAccountId: account.id,
        publishedAt: {
          gte: parseYmdToUtcStart(from),
          lte: parseYmdToUtcEnd(to),
        },
      },
      orderBy: { publishedAt: "desc" },
      take: limit,
      select: {
        id: true,
        mediaType: true,
        publishedAt: true,
        caption: true,
        thumb: true,
        likeCount: true,
        commentsCount: true,
        metrics: {
          orderBy: { pulledAt: "desc" },
          take: 1,
          select: {
            reach: true,
            plays: true,
            videoViews: true,
            likes: true,
            comments: true,
            totalInteractions: true,
          },
        },
      },
    });

    const viewList = posts.map((p) => {
      const m = p.metrics?.[0];
      const reach = safeNum(m?.reach);
      const plays = safeNum(m?.plays);
      const videoViews = safeNum(m?.videoViews);
      return Math.max(reach, plays, videoViews);
    });

    const avgViews = viewList.length
      ? viewList.reduce((a, b) => a + b, 0) / viewList.length
      : 0;

    const items = posts.map((p) => {
      const m = p.metrics?.[0];
      const views = Math.max(
        safeNum(m?.reach),
        safeNum(m?.plays),
        safeNum(m?.videoViews),
      );
      const likes = Math.trunc(safeNum(m?.likes ?? p.likeCount));
      const comments = Math.trunc(safeNum(m?.comments ?? p.commentsCount));
      const vsAvgPct =
        avgViews > 0 ? Math.round(((views - avgViews) / avgViews) * 100) : 0;

      let tag: "above_avg" | "below_avg" | "outlier_plus" | "outlier_minus" =
        "above_avg";
      if (vsAvgPct >= 100) tag = "outlier_plus";
      else if (vsAvgPct <= -50) tag = "outlier_minus";
      else if (vsAvgPct >= 20) tag = "above_avg";
      else if (vsAvgPct <= -20) tag = "below_avg";

      const title = s(p.caption).slice(0, 120) || "(sem legenda)";

      return {
        id: p.id,
        title,
        type: toPostType(p.mediaType),
        dateLabel: formatPostDateLabel(p.publishedAt as Date),
        views: Math.trunc(views),
        likes,
        comments,
        vsAvgPct,
        tag,
        thumbnailUrl: p.thumb ?? null,
      };
    });

    return res.json({
      ok: true,
      instagramAccountId: account.id,
      filters: { from, to, limit, forceMetrics },
      avgViews: Math.round(avgViews),
      items,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao gerar análise de conteúdo",
      detail: String(error?.message ?? error),
    });
  }
}

export async function getInstagramEngagementAnalytics(req: Request, res: Response) {
  try {
    res.setHeader("Cache-Control", "no-store");

    const userId = getUserId(req);
    if (!userId)
      return res.status(401).json({ ok: false, message: "Não autenticado" });

    const fromRaw = s(req.query.from);
    const toRaw = s(req.query.to);
    const requestedAccountId = s(req.query.instagramAccountId);

    const forceMetrics =
      s(req.query.force).toLowerCase() === "1" ||
      s(req.query.force).toLowerCase() === "true";

    if (!isValidYmd(fromRaw) || !isValidYmd(toRaw)) {
      return res
        .status(400)
        .json({ ok: false, message: "from/to inválidos (YYYY-MM-DD)" });
    }
    if (fromRaw > toRaw) {
      return res.status(400).json({ ok: false, message: "Range inválido" });
    }

    const clamped = clampDaysRange(fromRaw, toRaw, 30);
    const from = clamped.from;
    const to = clamped.to;

    const account = await resolveInstagramAccount(userId, requestedAccountId);
    if (!account?.id) {
      return res.json({
        ok: true,
        instagramAccountId: null,
        filters: { from, to },
        daily: [],
        message: "Nenhuma conta do Instagram conectada",
      });
    }

    const accessToken = s(account.pageAccessToken) || s(account.accessToken);
    if (!account.igUserId || !accessToken) {
      return res
        .status(400)
        .json({ ok: false, message: "Conta IG sem token válido" });
    }

    await ensurePostsAndMetricsInRange({
      userId,
      instagramAccountId: account.id,
      igUserId: account.igUserId,
      accessToken,
      from,
      to,
      maxPosts: 500,
      forceMetrics,
    });

    const posts = await prisma.instagramPost.findMany({
      where: {
        userId,
        instagramAccountId: account.id,
        publishedAt: {
          gte: parseYmdToUtcStart(from),
          lte: parseYmdToUtcEnd(to),
        },
      },
      select: {
        publishedAt: true,
        likeCount: true,
        commentsCount: true,
        metrics: {
          orderBy: { pulledAt: "desc" },
          take: 1,
          select: { likes: true, comments: true, saves: true, shares: true },
        },
      },
    });

    const map = new Map<
      string,
      { likes: number; comments: number; saves: number; shares: number }
    >();

    for (const p of posts) {
      const day = ymdUtcKey(p.publishedAt as Date);
      const cur = map.get(day) ?? { likes: 0, comments: 0, saves: 0, shares: 0 };

      const m = p.metrics?.[0];
      cur.likes += Math.trunc(safeNum(m?.likes ?? p.likeCount));
      cur.comments += Math.trunc(safeNum(m?.comments ?? p.commentsCount));
      cur.saves += Math.trunc(safeNum(m?.saves));
      cur.shares += Math.trunc(safeNum(m?.shares));

      map.set(day, cur);
    }

    const daily = listDays(from, to).map((d) => {
      const v = map.get(d) ?? { likes: 0, comments: 0, saves: 0, shares: 0 };
      return { day: d, ...v };
    });

    return res.json({
      ok: true,
      instagramAccountId: account.id,
      filters: { from, to, forceMetrics },
      daily,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao gerar diagnóstico de engajamento",
      detail: String(error?.message ?? error),
    });
  }
}

export async function getInstagramCorrelationAnalytics(req: Request, res: Response) {
  try {
    res.setHeader("Cache-Control", "no-store");

    const userId = getUserId(req);
    if (!userId)
      return res.status(401).json({ ok: false, message: "Não autenticado" });

    const fromRaw = s(req.query.from);
    const toRaw = s(req.query.to);
    const requestedAccountId = s(req.query.instagramAccountId);

    const forceMetrics =
      s(req.query.force).toLowerCase() === "1" ||
      s(req.query.force).toLowerCase() === "true";

    if (!isValidYmd(fromRaw) || !isValidYmd(toRaw)) {
      return res
        .status(400)
        .json({ ok: false, message: "from/to inválidos (YYYY-MM-DD)" });
    }
    if (fromRaw > toRaw) {
      return res.status(400).json({ ok: false, message: "Range inválido" });
    }

    const clamped = clampDaysRange(fromRaw, toRaw, 30);
    const from = clamped.from;
    const to = clamped.to;

    const account = await resolveInstagramAccount(userId, requestedAccountId);
    if (!account?.id) {
      return res.json({
        ok: true,
        instagramAccountId: null,
        filters: { from, to },
        cells: [],
        message: "Nenhuma conta do Instagram conectada",
      });
    }

    const accessToken = s(account.pageAccessToken) || s(account.accessToken);
    if (!account.igUserId || !accessToken) {
      return res
        .status(400)
        .json({ ok: false, message: "Conta IG sem token válido" });
    }

    await ensurePostsAndMetricsInRange({
      userId,
      instagramAccountId: account.id,
      igUserId: account.igUserId,
      accessToken,
      from,
      to,
      maxPosts: 500,
      forceMetrics,
    });

    const posts = await prisma.instagramPost.findMany({
      where: {
        userId,
        instagramAccountId: account.id,
        publishedAt: {
          gte: parseYmdToUtcStart(from),
          lte: parseYmdToUtcEnd(to),
        },
      },
      select: {
        publishedAt: true,
        metrics: {
          orderBy: { pulledAt: "desc" },
          take: 1,
          select: {
            reach: true,
            totalInteractions: true,
            likes: true,
            comments: true,
            saves: true,
            shares: true,
          },
        },
      },
    });

    const agg = new Map<string, { sum: number; count: number }>();

    for (const p of posts) {
      const m = p.metrics?.[0];
      const reach = safeNum(m?.reach);

      const interactions = safeNum(
        m?.totalInteractions ??
          (safeNum(m?.likes) +
            safeNum(m?.comments) +
            safeNum(m?.saves) +
            safeNum(m?.shares)),
      );

      if (reach <= 0) continue;

      const rate = (interactions / reach) * 100;
      const value = Math.max(0, Math.min(1000, Math.round(rate)));

      const dKey = dayKeyPtBr(p.publishedAt as Date);
      const hLabel = hourLabel(p.publishedAt as Date);

      const key = `${dKey}|${hLabel}`;
      const cur = agg.get(key) ?? { sum: 0, count: 0 };
      cur.sum += value;
      cur.count += 1;
      agg.set(key, cur);
    }

    const cells = Array.from(agg.entries()).map(([k, v]) => {
      const [dayKey, hourLabel] = k.split("|") as any;
      return {
        dayKey,
        hourLabel,
        value: v.count ? Math.round(v.sum / v.count) : null,
      };
    });

    return res.json({
      ok: true,
      instagramAccountId: account.id,
      filters: { from, to, forceMetrics },
      cells,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao gerar correlação conteúdo × resultado",
      detail: String(error?.message ?? error),
    });
  }
}
