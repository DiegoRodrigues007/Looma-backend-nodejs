// src/presentation/http/controllers/instagram/InstagramDropSaturationController.ts
import type { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../../../infrastructure/db/prismaClient";

type Severity = "low" | "medium" | "high";

type DropType =
  | "drop_reach"
  | "drop_interactions"
  | "drop_profile_views"
  | "saturation_frequency";

type DropInsight = {
  id: string;
  type: DropType;
  severity: Severity;
  title: string;
  message: string;
  confidence: number; // 0..1
  evidence: Record<string, any>;
  actions?: { label: string; reason?: string }[];
};

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

function ymdUtcKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function pctChange(cur: number, prev: number) {
  // evita explosão quando prev = 0
  const denom = Math.max(1, prev);
  return (cur - prev) / denom;
}

function mean(nums: number[]) {
  if (!nums.length) return 0;
  let sum = 0;
  for (const n of nums) sum += n;
  return sum / nums.length;
}

function listDaysInclusive(fromUtcStart: Date, toUtcStart: Date): Date[] {
  const out: Date[] = [];
  const t0 = fromUtcStart.getTime();
  const t1 = toUtcStart.getTime();
  for (let t = t0; t <= t1; t += 86400000) out.push(new Date(t));
  return out;
}

function countValidDays(reach: number[], interactions: number[], views: number[]) {
  let c = 0;
  for (let i = 0; i < reach.length; i++) {
    if ((reach[i] ?? 0) > 0 || (interactions[i] ?? 0) > 0 || (views[i] ?? 0) > 0) c++;
  }
  return c;
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
      select: { id: true, igUserId: true },
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
      select: { id: true, igUserId: true },
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
    select: { id: true, igUserId: true },
  });
}

/**
 * GET /api/instagram/analytics/drop-saturation?from=YYYY-MM-DD&to=YYYY-MM-DD&instagramAccountId?
 *
 * ✅ cálculo:
 * - Queda: compara média do período vs período anterior (mesmo tamanho)
 * - Saturação: aumento de frequência (posts/dia) com queda de entrega/resultado
 *
 * ✅ Ajuste MVP:
 * - Não exige 3 dias válidos em ambos períodos (isso zerava tudo em conta nova).
 * - Bloqueia apenas quando o período atual não tem NENHUM dado.
 * - Só calcula quedas se houver algum histórico no período anterior.
 */
export async function getInstagramDropSaturationAnalytics(req: Request, res: Response) {
  try {
    const userId = getUserId(req as any);
    if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });

    const fromRaw = s((req.query as any)?.from);
    const toRaw = s((req.query as any)?.to);
    const requestedInstagramAccountId = s((req.query as any)?.instagramAccountId);

    if (!isValidYmd(fromRaw) || !isValidYmd(toRaw)) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_RANGE",
        message: "Parâmetros 'from' e 'to' devem estar no formato YYYY-MM-DD.",
      });
    }

    const fromStart = parseYmdToUtcStart(fromRaw);
    const toStart = parseYmdToUtcStart(toRaw);

    if (fromStart.getTime() > toStart.getTime()) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_RANGE",
        message: "A data inicial (from) não pode ser maior que a data final (to).",
      });
    }

    // max 30 dias (inclusive)
    const days = Math.floor((toStart.getTime() - fromStart.getTime()) / 86400000) + 1;
    if (days > 30) {
      return res.status(400).json({
        ok: false,
        error: "RANGE_TOO_LARGE",
        message: "O período máximo permitido é de 30 dias.",
        debug: { days },
      });
    }

    const acc = await resolveInstagramAccount(userId, requestedInstagramAccountId);
    if (!acc) {
      return res.status(400).json({
        ok: false,
        error: "NO_ACTIVE_ACCOUNT",
        message: "Nenhuma conta do Instagram conectada foi encontrada para este usuário.",
      });
    }

    const instagramAccountIdUsed = acc.id;

    // Período anterior com mesmo tamanho: [from-days, from-1]
    const prevFrom = new Date(fromStart.getTime() - days * 86400000);
    const prevTo = new Date(fromStart.getTime() - 86400000);

    const curRows = await prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId,
        instagramAccountId: instagramAccountIdUsed,
        day: { gte: fromStart, lte: parseYmdToUtcEnd(toRaw) },
      },
      orderBy: { day: "asc" },
      select: { day: true, reach: true, totalInteractions: true, profileViewsTotal: true },
    });

    const prevRows = await prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId,
        instagramAccountId: instagramAccountIdUsed,
        day: { gte: prevFrom, lte: prevTo },
      },
      orderBy: { day: "asc" },
      select: { day: true, reach: true, totalInteractions: true, profileViewsTotal: true },
    });

    // ✅ Preenche séries com 0 para TODOS os dias do range (evita "média enganosa" por faltar dias)
    const curDays = listDaysInclusive(fromStart, toStart);
    const prevDays = listDaysInclusive(prevFrom, prevTo);

    const curByDay = new Map(
      curRows.map(r => [
        ymdUtcKey(r.day as any as Date),
        {
          reach: r.reach ?? 0,
          interactions: r.totalInteractions ?? 0,
          views: r.profileViewsTotal ?? 0,
        },
      ])
    );

    const prevByDay = new Map(
      prevRows.map(r => [
        ymdUtcKey(r.day as any as Date),
        {
          reach: r.reach ?? 0,
          interactions: r.totalInteractions ?? 0,
          views: r.profileViewsTotal ?? 0,
        },
      ])
    );

    const curReach = curDays.map(d => curByDay.get(ymdUtcKey(d))?.reach ?? 0);
    const curInt = curDays.map(d => curByDay.get(ymdUtcKey(d))?.interactions ?? 0);
    const curViews = curDays.map(d => curByDay.get(ymdUtcKey(d))?.views ?? 0);

    const prevReach = prevDays.map(d => prevByDay.get(ymdUtcKey(d))?.reach ?? 0);
    const prevInt = prevDays.map(d => prevByDay.get(ymdUtcKey(d))?.interactions ?? 0);
    const prevViews = prevDays.map(d => prevByDay.get(ymdUtcKey(d))?.views ?? 0);

    const curValidDays = countValidDays(curReach, curInt, curViews);
    const prevValidDays = countValidDays(prevReach, prevInt, prevViews);

    // ✅ BLOQUEIA APENAS se o período atual não tem NADA (isso sim é "sem dados")
    if (curValidDays === 0) {
      return res.json({
        ok: true,
        range: { from: fromRaw, to: toRaw, days },
        requestedInstagramAccountId: requestedInstagramAccountId || null,
        instagramAccountIdUsed,
        insights: [],
        debug: {
          reason: "INSUFFICIENT_DATA_CURRENT_RANGE",
          curValidDays,
          prevValidDays,
          prevWindow: { from: ymdUtcKey(prevFrom), to: ymdUtcKey(prevTo) },
          hint:
            "Não há métricas diárias (reach/interactions/profileViews) registradas no período atual. Rode o backfill/worker para popular instagramAccountDailyMetrics.",
        },
      });
    }

    const curReachAvg = mean(curReach);
    const curIntAvg = mean(curInt);
    const curViewsAvg = mean(curViews);

    const prevReachAvg = mean(prevReach);
    const prevIntAvg = mean(prevInt);
    const prevViewsAvg = mean(prevViews);

    const reachPct = pctChange(curReachAvg, prevReachAvg);
    const intPct = pctChange(curIntAvg, prevIntAvg);
    const viewsPct = pctChange(curViewsAvg, prevViewsAvg);

    const insights: DropInsight[] = [];

    function addDrop(
      type: DropType,
      pct: number,
      title: string,
      metricLabel: string,
      curAvg: number,
      prevAvg: number
    ) {
      // ⚠️ Só faz comparação se tiver algum histórico no período anterior
      if (prevValidDays === 0) return;

      // thresholds (ajustáveis sem quebrar API)
      // -20% = medium, -35% = high
      if (pct > -0.2) return;

      const severity: Severity = pct <= -0.35 ? "high" : "medium";
      const conf = clamp01(Math.min(1, Math.abs(pct) / 0.6)); // 0..1

      insights.push({
        id: crypto.randomUUID(),
        type,
        severity,
        title,
        message: `${metricLabel} caiu ${(Math.abs(pct) * 100).toFixed(0)}% vs período anterior.`,
        confidence: conf,
        evidence: {
          currentAvg: curAvg,
          prevAvg,
          pctChange: pct,
          windows: {
            current: { from: fromRaw, to: toRaw },
            previous: { from: ymdUtcKey(prevFrom), to: ymdUtcKey(prevTo) },
          },
          samples: { curValidDays, prevValidDays },
        },
        actions: [
          { label: "Ver dias de maior queda", reason: "Localizar o início da mudança de padrão." },
          { label: "Checar consistência e formatos", reason: "Mudança de mix pode afetar distribuição." },
        ],
      });
    }

    addDrop("drop_reach", reachPct, "Queda de alcance", "Alcance médio diário", curReachAvg, prevReachAvg);
    addDrop("drop_interactions", intPct, "Queda de interações", "Interações totais diárias", curIntAvg, prevIntAvg);
    addDrop(
      "drop_profile_views",
      viewsPct,
      "Queda de visitas ao perfil",
      "Visitas ao perfil diárias",
      curViewsAvg,
      prevViewsAvg
    );

    // Saturação: frequência (posts/dia) ↑ e entrega/resultado ↓
    const curPosts = await prisma.instagramPost.count({
      where: {
        userId,
        instagramAccountId: instagramAccountIdUsed,
        publishedAt: { gte: fromStart, lte: parseYmdToUtcEnd(toRaw) },
      },
    });

    const prevPosts = await prisma.instagramPost.count({
      where: {
        userId,
        instagramAccountId: instagramAccountIdUsed,
        publishedAt: { gte: prevFrom, lte: prevTo },
      },
    });

    const curPostsPerDay = curPosts / days;
    const prevPostsPerDay = prevPosts / days;

    const freqPct = pctChange(curPostsPerDay, prevPostsPerDay);

    const deliveryDown = reachPct <= -0.15 || intPct <= -0.15; // queda relevante
    const freqUp = freqPct >= 0.25; // frequência subiu

    if (freqUp && deliveryDown) {
      const conf = clamp01(Math.min(1, (freqPct + Math.abs(Math.min(reachPct, intPct))) / 1.2));

      insights.push({
        id: crypto.randomUUID(),
        type: "saturation_frequency",
        severity: "high",
        title: "Sinais de saturação (frequência)",
        message:
          "A frequência de postagem aumentou, mas a entrega/resultado médio caiu. Pode ser saturação de formato ou excesso de volume no período.",
        confidence: conf,
        evidence: {
          posts: {
            current: { count: curPosts, perDay: curPostsPerDay },
            previous: { count: prevPosts, perDay: prevPostsPerDay },
            pctChange: freqPct,
          },
          performance: {
            reachAvg: { current: curReachAvg, previous: prevReachAvg, pctChange: reachPct },
            interactionsAvg: { current: curIntAvg, previous: prevIntAvg, pctChange: intPct },
          },
          windows: {
            current: { from: fromRaw, to: toRaw, days },
            previous: { from: ymdUtcKey(prevFrom), to: ymdUtcKey(prevTo), days },
          },
          samples: { curValidDays, prevValidDays },
        },
        actions: [
          { label: "Reduzir volume por 7 dias", reason: "Testar se a entrega se recupera com menos posts." },
          { label: "Variar formato/tema", reason: "Saturação pode vir de repetição de padrão." },
        ],
      });
    }

    // Ordena por severidade/confiança e limita
    const severityRank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
    insights.sort((a, b) => {
      const s = severityRank[b.severity] - severityRank[a.severity];
      if (s !== 0) return s;
      return b.confidence - a.confidence;
    });

    return res.json({
      ok: true,
      range: { from: fromRaw, to: toRaw, days },
      requestedInstagramAccountId: requestedInstagramAccountId || null,
      instagramAccountIdUsed,
      insights: insights.slice(0, 8),
      debug: {
        computedAt: new Date().toISOString(),
        prevWindow: { from: ymdUtcKey(prevFrom), to: ymdUtcKey(prevTo) },
        curValidDays,
        prevValidDays,
        currentAverages: { reach: curReachAvg, interactions: curIntAvg, profileViews: curViewsAvg },
        prevAverages: { reach: prevReachAvg, interactions: prevIntAvg, profileViews: prevViewsAvg },
        note:
          prevValidDays === 0
            ? "Sem histórico suficiente no período anterior para comparar quedas; saturação ainda pode aparecer."
            : undefined,
      },
    });
  } catch (err: any) {
    console.error("[DROP_SATURATION] Error:", err?.message ?? err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "Falha ao gerar análise de queda e saturação do período.",
    });
  }
}
