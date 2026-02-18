import crypto from "crypto";
import { prisma } from "../../../../infrastructure/db/prismaClient";
import type { Insight } from "../../../../shared/types/insights/types";

function ymdUtcKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parseYmdToUtcStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}
function parseYmdToUtcEnd(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999Z`);
}
function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function mean(nums: number[]) {
  if (!nums.length) return 0;
  let s = 0;
  for (const n of nums) s += n;
  return s / nums.length;
}

export async function predictionEngine(args: {
  userId: string;
  instagramAccountId: string;
  to: string;
  lookbackDays?: number; 
  horizonDays?: number; 
}): Promise<{ insights: Insight[]; debug: Record<string, any> }> {
  const { userId, instagramAccountId, to } = args;
  const lookbackDays = Number.isFinite(Number(args.lookbackDays)) ? Number(args.lookbackDays) : 14;
  const horizonDays = Number.isFinite(Number(args.horizonDays)) ? Number(args.horizonDays) : 7;

  const toStart = parseYmdToUtcStart(to);
  const toEnd = parseYmdToUtcEnd(to);

  const fromStart = new Date(toStart.getTime() - lookbackDays * 86400000);

  const fromMinus1 = new Date(fromStart.getTime() - 86400000);

  const daily = await prisma.instagramAccountDailyMetrics.findMany({
    where: {
      userId,
      instagramAccountId,
      day: { gte: fromMinus1, lte: toEnd },
    },
    select: { day: true, followers: true },
    orderBy: { day: "asc" },
  });

  const followersByDay = new Map<string, number | null>();
  for (const r of daily) followersByDay.set(ymdUtcKey(r.day), r.followers ?? null);

  const deltas: number[] = [];
  for (let ms = fromStart.getTime(); ms <= toStart.getTime(); ms += 86400000) {
    const day = ymdUtcKey(new Date(ms));
    const prev = ymdUtcKey(new Date(ms - 86400000));
    const fToday = followersByDay.get(day) ?? null;
    const fPrev = followersByDay.get(prev) ?? null;
    if (fToday === null || fPrev === null) continue;
    deltas.push(fToday - fPrev);
  }

  if (deltas.length < Math.min(8, lookbackDays)) {
    return {
      insights: [],
      debug: { reason: "INSUFFICIENT_DELTAS", deltas: deltas.length, lookbackDays },
    };
  }

  const avgDaily = mean(deltas);
  const projected = avgDaily * horizonDays;

  const confidence = clamp01(Math.min(1, deltas.length / 21) * Math.min(1, Math.abs(avgDaily) / 10 + 0.2));

  const insight: Insight = {
    id: crypto.randomUUID(),
    type: "prediction" as any,
    title: "Tendência de crescimento (estimativa)",
    message:
      avgDaily >= 0
        ? `Mantendo o ritmo recente, a estimativa é de **+${Math.round(
            projected
          )} seguidores** nos próximos **${horizonDays} dias** (≈ +${avgDaily.toFixed(1)}/dia).`
        : `Mantendo o ritmo recente, a estimativa é de **${Math.round(
            projected
          )} seguidores** nos próximos **${horizonDays} dias** (≈ ${avgDaily.toFixed(1)}/dia).`,
    confidence,
    evidence: {
      lookbackDays,
      horizonDays,
      avgDeltaFollowersPerDay: avgDaily,
      projectedDeltaFollowers: projected,
      sampleSize: deltas.length,
    },
    actions:
      avgDaily >= 0
        ? [{ label: "Manter consistência", reason: "A tendência recente está positiva." }]
        : [{ label: "Rever estratégia do período", reason: "A tendência recente está negativa." }],
  };

  return { insights: [insight], debug: { avgDaily, projected, sampleSize: deltas.length } };
}
