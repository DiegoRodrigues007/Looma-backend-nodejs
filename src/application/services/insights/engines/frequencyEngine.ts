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
function pearson(xs: number[], ys: number[]) {
  const n = Math.min(xs.length, ys.length);
  if (n < 6) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy) || 0;
  return den === 0 ? 0 : num / den;
}

export async function frequencyEngine(args: {
  userId: string;
  instagramAccountId: string;
  from: string;
  to: string;
}): Promise<{ insights: Insight[]; debug: Record<string, any> }> {
  const { userId, instagramAccountId, from, to } = args;

  const fromStart = parseYmdToUtcStart(from);
  const toEnd = parseYmdToUtcEnd(to);

  const posts = await prisma.instagramPost.findMany({
    where: {
      userId,
      instagramAccountId,
      publishedAt: { gte: fromStart, lte: toEnd },
    },
    select: { publishedAt: true },
  });

  const postsCountByDay = new Map<string, number>();
  for (const p of posts) {
    const day = ymdUtcKey(p.publishedAt);
    postsCountByDay.set(day, (postsCountByDay.get(day) ?? 0) + 1);
  }

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

  const xs: number[] = [];
  const ys: number[] = [];
  const points: { day: string; posts: number; delta: number }[] = [];

  for (
    let ms = fromStart.getTime();
    ms <= parseYmdToUtcStart(to).getTime();
    ms += 86400000
  ) {
    const day = ymdUtcKey(new Date(ms));
    const prev = ymdUtcKey(new Date(ms - 86400000));

    const fToday = followersByDay.get(day) ?? null;
    const fPrev = followersByDay.get(prev) ?? null;
    if (fToday === null || fPrev === null) continue;

    const delta = fToday - fPrev;
    const count = postsCountByDay.get(day) ?? 0;

    xs.push(count);
    ys.push(delta);
    points.push({ day, posts: count, delta });
  }

  if (points.length < 8) {
    return { insights: [], debug: { reason: "INSUFFICIENT_POINTS", points: points.length } };
  }

  const r = pearson(xs, ys);

  if (Math.abs(r) < 0.35) {
    return { insights: [], debug: { reason: "WEAK_CORRELATION", r, points: points.length } };
  }

  const zeros = points.filter((p) => p.posts === 0).map((p) => p.delta);
  const twoPlus = points.filter((p) => p.posts >= 2).map((p) => p.delta);

  const avg0 = mean(zeros);
  const avg2 = mean(twoPlus);
  const lift = avg2 - avg0;

  const confidence = clamp01(Math.abs(r) * Math.min(1, points.length / 20));

  const insight: Insight = {
    id: crypto.randomUUID(),
    type: "frequency_driver" as any,
    title: "Frequência de postagem e crescimento",
    message:
      r > 0
        ? `Há uma correlação **positiva** entre frequência de posts e crescimento de seguidores (r ≈ ${r.toFixed(
            2
          )}). Em dias com **2+ posts**, o crescimento médio tende a ser maior (≈ ${avg2.toFixed(
            1
          )}/dia) do que em dias com **0 post** (≈ ${avg0.toFixed(1)}/dia).`
        : `Há uma correlação **negativa** entre frequência de posts e crescimento de seguidores (r ≈ ${r.toFixed(
            2
          )}). Em dias com **2+ posts**, o crescimento médio tende a ser menor (≈ ${avg2.toFixed(
            1
          )}/dia) do que em dias com **0 post** (≈ ${avg0.toFixed(1)}/dia).`,
    confidence,
    evidence: {
      r,
      points: points.length,
      avgDeltaWhen0Posts: avg0,
      avgDeltaWhen2PlusPosts: avg2,
      lift2PlusVs0: lift,
    },
    actions:
      r > 0
        ? [{ label: "Testar consistência com 1–2 posts/dia", reason: "Frequência aparece associada a maior crescimento." }]
        : [{ label: "Evitar excesso de posts no mesmo dia", reason: "Frequência aparece associada a crescimento menor." }],
  };

  return { insights: [insight], debug: { r, points: points.length, avg0, avg2, lift } };
}
