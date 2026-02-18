import crypto from "crypto";
import { prisma } from "../../../../infrastructure/db/prismaClient";
import type { Insight } from "../../../../shared/types/insights/types";

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

export async function baselineEngine(args: {
  userId: string;
  instagramAccountId: string;
  from: string;
  to: string;
  baselineDays: number;
}): Promise<{ insights: Insight[]; debug: Record<string, any> }> {
  const { userId, instagramAccountId, from, to, baselineDays } = args;

  const fromStart = parseYmdToUtcStart(from);
  const toStart = parseYmdToUtcStart(to);

  const fromMinus1 = new Date(fromStart.getTime() - 86400000);

  const rangeRows = await prisma.instagramAccountDailyMetrics.findMany({
    where: {
      userId,
      instagramAccountId,
      day: { gte: fromMinus1, lte: parseYmdToUtcEnd(to) },
    },
    orderBy: { day: "asc" },
    select: { day: true, followers: true },
  });

  const followersByDay = new Map<string, number | null>();
  for (const r of rangeRows) {
    followersByDay.set(ymdUtcKey(r.day), r.followers ?? null);
  }

  const deltasInRange: { day: string; delta: number | null }[] = [];

  for (let ms = fromStart.getTime(); ms <= toStart.getTime(); ms += 86400000) {
    const day = ymdUtcKey(new Date(ms));
    const prev = ymdUtcKey(new Date(ms - 86400000));

    const fToday = followersByDay.get(day) ?? null;
    const fPrev = followersByDay.get(prev) ?? null;

    if (fToday === null || fPrev === null)
      deltasInRange.push({ day, delta: null });
    else deltasInRange.push({ day, delta: fToday - fPrev });
  }

  const baselineStart = new Date(fromStart.getTime() - baselineDays * 86400000);
  const baselineEnd = new Date(fromStart.getTime() - 1);

  const baselineStartMinus1 = new Date(baselineStart.getTime() - 86400000);

  const baselineRows = await prisma.instagramAccountDailyMetrics.findMany({
    where: {
      userId,
      instagramAccountId,
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
  for (
    let ms = baselineStart.getTime();
    ms <= baselineEnd.getTime();
    ms += 86400000
  ) {
    const day = ymdUtcKey(new Date(ms));
    const prev = ymdUtcKey(new Date(ms - 86400000));

    const fToday = baselineFollowersByDay.get(day) ?? null;
    const fPrev = baselineFollowersByDay.get(prev) ?? null;

    if (fToday === null || fPrev === null) continue;
    baselineDeltas.push(fToday - fPrev);
  }

  const validRangeDeltas = deltasInRange
    .map((d) => d.delta)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const baselineSampleSize = baselineDeltas.length;
  const rangeSampleSize = validRangeDeltas.length;

  if (baselineSampleSize < 10 || rangeSampleSize < 3) {
    return {
      insights: [],
      debug: {
        reason: "INSUFFICIENT_DATA",
        baselineSampleSize,
        rangeSampleSize,
        baselineWindow: {
          start: ymdUtcKey(baselineStart),
          end: ymdUtcKey(baselineEnd),
        },
      },
    };
  }

  const mu = mean(baselineDeltas);
  const sigma = stddev(baselineDeltas) || 1;

  const rangeMu = mean(validRangeDeltas);
  const zRange = (rangeMu - mu) / sigma;

  const insights: Insight[] = [];

  if (zRange >= 0.8) {
    insights.push({
      id: crypto.randomUUID(),
      type: "baseline_above_normal",
      title: "Crescimento acima do normal",
      message:
        "Neste período, o crescimento diário de seguidores ficou acima do seu padrão histórico recente.",
      confidence: clamp01(Math.abs(zRange) / 3),
      evidence: {
        baseline: { meanDelta: mu, stdDelta: sigma },
        range: { meanDelta: rangeMu, z: zRange },
      },
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
        baseline: { meanDelta: mu, stdDelta: sigma },
        range: { meanDelta: rangeMu, z: zRange },
      },
    });
  }

  const anomalies = deltasInRange
    .filter((d) => typeof d.delta === "number" && Number.isFinite(d.delta))
    .map((d) => ({ ...d, z: ((d.delta as number) - mu) / sigma }))
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
        ? `No dia ${a.day}, houve um pico de crescimento fora do padrão (Δ ${delta}).`
        : `No dia ${a.day}, houve uma queda fora do padrão (Δ ${delta}).`,
      confidence: clamp01(Math.abs(a.z) / 4),
      evidence: { day: a.day, deltaFollowers: delta, z: a.z },
    });
  }

  return {
    insights,
    debug: {
      baselineWindow: {
        start: ymdUtcKey(baselineStart),
        end: ymdUtcKey(baselineEnd),
      },
      baselineSampleSize,
      rangeSampleSize,
      baseline: { meanDelta: mu, stdDelta: sigma },
      range: { meanDelta: rangeMu, z: zRange },
    },
  };
}
