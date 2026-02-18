// src/presentation/http/controllers/instagram/InstagramInsightsController.ts
import type { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../../../infrastructure/db/prismaClient";

type InsightType =
  | "baseline_above_normal"
  | "baseline_below_normal"
  | "baseline_spike"
  | "baseline_drop";

type Insight = {
  id: string;
  type: InsightType;
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

function mean(nums: number[]) {
  if (!nums.length) return 0;
  let sum = 0;
  for (const n of nums) sum += n;
  return sum / nums.length;
}

function stddev(nums: number[]) {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  let acc = 0;
  for (const n of nums) acc += (n - m) * (n - m);
  return Math.sqrt(acc / (nums.length - 1));
}

function median(nums: number[]) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function mad(nums: number[]) {
  // Median Absolute Deviation (robusto p/ range pequeno)
  if (nums.length < 2) return 0;
  const m = median(nums);
  const abs = nums.map((x) => Math.abs(x - m));
  return median(abs);
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
 * GET /api/instagram/analytics/insights?from=YYYY-MM-DD&to=YYYY-MM-DD&instagramAccountId?
 *
 * Ajuste MVP:
 * - Não ficar "sempre vazio" quando baseline ainda é pequeno.
 * - Se baseline for insuficiente, usa fallback com o próprio range e retorna ao menos 1 insight informativo.
 */
export async function getInstagramInsightsAnalytics(req: Request, res: Response) {
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

    // --- Fetch daily metrics para calcular deltas (range + 1 dia antes) ---
    const fromMinus1 = new Date(fromStart.getTime() - 86400000);
    const rangeRows = await prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId,
        instagramAccountId: instagramAccountIdUsed,
        day: { gte: fromMinus1, lte: parseYmdToUtcEnd(toRaw) },
      },
      orderBy: { day: "asc" },
      select: { day: true, followers: true },
    });

    const followersByDay = new Map<string, number | null>();
    for (const r of rangeRows) {
      const k = ymdUtcKey(r.day);
      followersByDay.set(k, r.followers ?? null);
    }

    // deltas do range (precisa do dia anterior)
    const deltasInRange: { day: string; delta: number | null }[] = [];
    for (let ms = fromStart.getTime(); ms <= toStart.getTime(); ms += 86400000) {
      const day = ymdUtcKey(new Date(ms));
      const prev = ymdUtcKey(new Date(ms - 86400000));
      const fToday = followersByDay.get(day) ?? null;
      const fPrev = followersByDay.get(prev) ?? null;

      if (fToday === null || fPrev === null) {
        deltasInRange.push({ day, delta: null });
      } else {
        deltasInRange.push({ day, delta: fToday - fPrev });
      }
    }

    // --- Baseline: últimos 60 dias antes do from (deltas) ---
    const baselineDays = 60;
    const baselineStart = new Date(fromStart.getTime() - baselineDays * 86400000);
    const baselineEnd = new Date(fromStart.getTime() - 1); // até o ms anterior ao fromStart

    // puxa baseline + 1 dia antes do baselineStart pra conseguir o primeiro delta
    const baselineStartMinus1 = new Date(baselineStart.getTime() - 86400000);

    const baselineRows = await prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId,
        instagramAccountId: instagramAccountIdUsed,
        day: { gte: baselineStartMinus1, lt: fromStart },
      },
      orderBy: { day: "asc" },
      select: { day: true, followers: true },
    });

    const baselineFollowersByDay = new Map<string, number | null>();
    for (const r of baselineRows) {
      baselineFollowersByDay.set(ymdUtcKey(r.day), r.followers ?? null);
    }

    const baselineDeltas: number[] = [];
    for (let ms = baselineStart.getTime(); ms <= baselineEnd.getTime(); ms += 86400000) {
      const day = ymdUtcKey(new Date(ms));
      const prev = ymdUtcKey(new Date(ms - 86400000));
      const fToday = baselineFollowersByDay.get(day) ?? null;
      const fPrev = baselineFollowersByDay.get(prev) ?? null;
      if (fToday === null || fPrev === null) continue;
      baselineDeltas.push(fToday - fPrev);
    }

    const insights: Insight[] = [];
    const validRangeDeltas = deltasInRange
      .map((d) => d.delta)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const baselineSampleSize = baselineDeltas.length;
    const rangeSampleSize = validRangeDeltas.length;

    // ✅ Thresholds MVP (menores)
    const MIN_BASELINE = 5; // antes 10
    const MIN_RANGE = 1; // antes 3

    // Se o range não tem nada, não dá pra fazer nem fallback
    if (rangeSampleSize < MIN_RANGE) {
      return res.json({
        ok: true,
        range: { from: fromRaw, to: toRaw, days },
        requestedInstagramAccountId: requestedInstagramAccountId || null,
        instagramAccountIdUsed,
        insights: [
          {
            id: crypto.randomUUID(),
            type: "baseline_below_normal",
            title: "Sem dados suficientes no período",
            message:
              "Ainda não há registros diários de seguidores suficientes no período selecionado para gerar insights. Rode o backfill/worker para popular os dias.",
            confidence: 0.35,
            evidence: {
              reason: "INSUFFICIENT_RANGE_DATA",
              rangeSampleSize,
              baselineSampleSize,
              rangeDays: days,
            },
            actions: [{ label: "Rodar backfill do período", reason: "Gerar métricas diárias para liberar insights." }],
          },
        ],
        debug: {
          reason: "INSUFFICIENT_RANGE_DATA",
          baselineSampleSize,
          rangeSampleSize,
          baselineWindow: { start: ymdUtcKey(baselineStart), end: ymdUtcKey(baselineEnd) },
        },
      });
    }

    // ✅ Se baseline é suficiente, usa o modelo original (z-score)
    if (baselineSampleSize >= MIN_BASELINE) {
      const mu = mean(baselineDeltas);
      const sigma = stddev(baselineDeltas) || 1; // evita /0

      const rangeMu = mean(validRangeDeltas);
      const zRange = (rangeMu - mu) / sigma;

      // Insight: acima/abaixo do normal
      if (zRange >= 0.8) {
        insights.push({
          id: crypto.randomUUID(),
          type: "baseline_above_normal",
          title: "Crescimento acima do normal",
          message:
            "Neste período, o crescimento diário de seguidores ficou acima do seu padrão histórico recente.",
          confidence: clamp01(Math.abs(zRange) / 3),
          evidence: {
            baseline: { meanDelta: mu, stdDelta: sigma, sampleSize: baselineSampleSize, days: baselineDays },
            range: { meanDelta: rangeMu, sampleSize: rangeSampleSize, z: zRange },
          },
          actions: [{ label: "Replicar o padrão do período", reason: "O ritmo de crescimento ficou acima do seu normal." }],
        });
      } else if (zRange <= -0.8) {
        insights.push({
          id: crypto.randomUUID(),
          type: "baseline_below_normal",
          title: "Crescimento abaixo do normal",
          message:
            "Neste período, o crescimento diário de seguidores ficou abaixo do seu padrão histórico recente.",
          confidence: clamp01(Math.abs(zRange) / 3),
          evidence: {
            baseline: { meanDelta: mu, stdDelta: sigma, sampleSize: baselineSampleSize, days: baselineDays },
            range: { meanDelta: rangeMu, sampleSize: rangeSampleSize, z: zRange },
          },
          actions: [{ label: "Investigar dias de queda", reason: "Houve perda/estagnação acima do seu padrão." }],
        });
      }

      // Anomalias (top 3)
      const anomalies = deltasInRange
        .filter((d) => typeof d.delta === "number" && Number.isFinite(d.delta))
        .map((d) => {
          const z = ((d.delta as number) - mu) / sigma;
          return { ...d, z };
        })
        .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
        .slice(0, 3)
        .filter((a) => Math.abs(a.z) >= 2);

      for (const a of anomalies) {
        const delta = a.delta as number;
        const isSpike = a.z >= 2;
        insights.push({
          id: crypto.randomUUID(),
          type: isSpike ? "baseline_spike" : "baseline_drop",
          title: isSpike ? "Pico fora do padrão" : "Queda fora do padrão",
          message: isSpike
            ? `No dia ${a.day}, houve um pico de crescimento de seguidores acima do seu padrão (Δ ${delta}).`
            : `No dia ${a.day}, houve uma queda/estagnação fora do padrão (Δ ${delta}).`,
          confidence: clamp01(Math.abs(a.z) / 4),
          evidence: {
            day: a.day,
            deltaFollowers: delta,
            z: a.z,
            baseline: { meanDelta: mu, stdDelta: sigma },
          },
          actions: isSpike
            ? [{ label: "Analisar o que foi publicado nesse dia", reason: "Pico pode indicar um formato vencedor." }]
            : [{ label: "Checar conteúdo/consistência do dia", reason: "Queda pode indicar ruptura de padrão." }],
        });
      }
    } else {
      // ✅ Fallback MVP: baseline insuficiente → usa apenas o range (robusto)
      const rangeMu = mean(validRangeDeltas);

      // Define um "sigma" robusto com MAD (evita ficar 0 em range pequeno)
      const m = median(validRangeDeltas);
      const madVal = mad(validRangeDeltas);
      const robustSigma = madVal > 0 ? madVal * 1.4826 : (stddev(validRangeDeltas) || 1);

      // Insight principal do período (sem baseline)
      if (rangeMu > 0) {
        insights.push({
          id: crypto.randomUUID(),
          type: "baseline_above_normal",
          title: "Tendência de crescimento no período",
          message:
            "Há uma tendência positiva de crescimento de seguidores no período selecionado. Para comparar com o seu ‘normal’, precisamos de mais histórico.",
          confidence: clamp01(Math.abs(rangeMu) / (robustSigma * 3)),
          evidence: {
            mode: "RANGE_ONLY_FALLBACK",
            range: { meanDelta: rangeMu, sampleSize: rangeSampleSize },
            robust: { median: m, mad: madVal, sigma: robustSigma },
            missing: {
              baselineSampleSize,
              requiredBaseline: MIN_BASELINE,
              baselineWindow: { start: ymdUtcKey(baselineStart), end: ymdUtcKey(baselineEnd) },
            },
          },
          actions: [
            { label: "Coletar mais histórico (backfill)", reason: "Liberar comparação com o padrão do seu perfil." },
          ],
        });
      } else if (rangeMu < 0) {
        insights.push({
          id: crypto.randomUUID(),
          type: "baseline_below_normal",
          title: "Tendência de queda no período",
          message:
            "Há uma tendência negativa de crescimento de seguidores no período selecionado. Para comparar com o seu ‘normal’, precisamos de mais histórico.",
          confidence: clamp01(Math.abs(rangeMu) / (robustSigma * 3)),
          evidence: {
            mode: "RANGE_ONLY_FALLBACK",
            range: { meanDelta: rangeMu, sampleSize: rangeSampleSize },
            robust: { median: m, mad: madVal, sigma: robustSigma },
            missing: {
              baselineSampleSize,
              requiredBaseline: MIN_BASELINE,
              baselineWindow: { start: ymdUtcKey(baselineStart), end: ymdUtcKey(baselineEnd) },
            },
          },
          actions: [
            { label: "Checar dias de maior queda", reason: "Identificar o que coincidiu com perdas/estagnação." },
            { label: "Coletar mais histórico (backfill)", reason: "Liberar comparação com o padrão do seu perfil." },
          ],
        });
      } else {
        insights.push({
          id: crypto.randomUUID(),
          type: "baseline_below_normal",
          title: "Crescimento estável no período",
          message:
            "O crescimento de seguidores ficou próximo de estável no período. Para comparar com o seu ‘normal’, precisamos de mais histórico.",
          confidence: 0.35,
          evidence: {
            mode: "RANGE_ONLY_FALLBACK",
            range: { meanDelta: rangeMu, sampleSize: rangeSampleSize },
            missing: { baselineSampleSize, requiredBaseline: MIN_BASELINE },
          },
          actions: [{ label: "Coletar mais histórico (backfill)", reason: "Liberar comparação com o padrão do seu perfil." }],
        });
      }

      // Anomalias dentro do range (top 3) usando z robusto
      const anomalies = deltasInRange
        .filter((d) => typeof d.delta === "number" && Number.isFinite(d.delta))
        .map((d) => {
          const z = ((d.delta as number) - m) / (robustSigma || 1);
          return { ...d, z };
        })
        .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
        .slice(0, 3)
        .filter((a) => Math.abs(a.z) >= 2);

      for (const a of anomalies) {
        const delta = a.delta as number;
        const isSpike = a.z >= 2;
        insights.push({
          id: crypto.randomUUID(),
          type: isSpike ? "baseline_spike" : "baseline_drop",
          title: isSpike ? "Pico no período" : "Queda no período",
          message: isSpike
            ? `No dia ${a.day}, houve um pico de crescimento no período (Δ ${delta}).`
            : `No dia ${a.day}, houve uma queda/estagnação acentuada no período (Δ ${delta}).`,
          confidence: clamp01(Math.abs(a.z) / 4),
          evidence: {
            mode: "RANGE_ONLY_FALLBACK",
            day: a.day,
            deltaFollowers: delta,
            z: a.z,
            robust: { median: m, sigma: robustSigma, mad: madVal },
          },
          actions: isSpike
            ? [{ label: "Ver conteúdo do dia", reason: "Pico pode indicar um formato vencedor." }]
            : [{ label: "Checar consistência do dia", reason: "Queda pode indicar ruptura de padrão." }],
        });
      }

      // ✅ Se por algum motivo ainda ficou vazio, garante um insight informativo
      if (insights.length === 0) {
        insights.push({
          id: crypto.randomUUID(),
          type: "baseline_below_normal",
          title: "Histórico insuficiente para comparação",
          message:
            "Ainda não há histórico suficiente para comparar seu desempenho com o padrão do seu perfil. Continue coletando dados para liberar insights mais precisos.",
          confidence: 0.3,
          evidence: {
            reason: "INSUFFICIENT_BASELINE_DATA",
            baselineSampleSize,
            requiredBaseline: MIN_BASELINE,
            rangeSampleSize,
          },
          actions: [{ label: "Rodar backfill de 60 dias", reason: "Popular métricas e liberar baseline." }],
        });
      }
    }

    // Ordena por confiança desc e limita (pra UI ficar limpa)
    insights.sort((a, b) => b.confidence - a.confidence);
    const insightsTop = insights.slice(0, 6);

    return res.json({
      ok: true,
      range: { from: fromRaw, to: toRaw, days },
      requestedInstagramAccountId: requestedInstagramAccountId || null,
      instagramAccountIdUsed,
      insights: insightsTop,
      debug: {
        computedAt: new Date().toISOString(),
        baselineWindow: { start: ymdUtcKey(baselineStart), end: ymdUtcKey(baselineEnd) },
        baselineSampleSize,
        rangeSampleSize,
        thresholds: { MIN_BASELINE, MIN_RANGE },
        mode: baselineSampleSize >= MIN_BASELINE ? "BASELINE_ZSCORE" : "RANGE_ONLY_FALLBACK",
      },
    });
  } catch (err: any) {
    console.error("[INSIGHTS] Error:", err?.message ?? err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "Falha ao gerar insights do período.",
    });
  }
}
