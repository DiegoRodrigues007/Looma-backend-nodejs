import crypto from "crypto";
import { prisma } from "../../../../infrastructure/db/prismaClient";
import type { Insight } from "../../../../shared/types/insights/types";


const SAO_PAULO_OFFSET_HOURS = -3;

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
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function mean(nums: number[]) {
  if (!nums.length) return 0;
  let s = 0;
  for (const n of nums) s += n;
  return s / nums.length;
}

function hourInSaoPaulo(dateUtc: Date): number {
  const ms = dateUtc.getTime() + SAO_PAULO_OFFSET_HOURS * 3600_000;
  return new Date(ms).getUTCHours(); 
}

type Bucket = "manha" | "tarde" | "noite" | "madrugada";
function bucketHour(h: number): Bucket {
  if (h >= 6 && h <= 11) return "manha";
  if (h >= 12 && h <= 17) return "tarde";
  if (h >= 18 && h <= 23) return "noite";
  return "madrugada"; 
}

function bucketLabel(b: Bucket) {
  switch (b) {
    case "manha":
      return "Manhã (06h–11h)";
    case "tarde":
      return "Tarde (12h–17h)";
    case "noite":
      return "Noite (18h–23h)";
    default:
      return "Madrugada (00h–05h)";
  }
}

export async function postingTimeEngine(args: {
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
    select: { id: true, publishedAt: true },
    orderBy: { publishedAt: "asc" },
  });

  if (posts.length < 8) {
    return {
      insights: [],
      debug: { reason: "INSUFFICIENT_POSTS", posts: posts.length },
    };
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

  const deltaByDay = new Map<string, number>();
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
    deltaByDay.set(day, fToday - fPrev);
  }

  if (deltaByDay.size < 6) {
    return {
      insights: [],
      debug: { reason: "INSUFFICIENT_FOLLOWERS_SERIES", daysWithDelta: deltaByDay.size },
    };
  }

  const bucketsByDay = new Map<string, Bucket[]>();
  for (const p of posts) {
    const day = ymdUtcKey(p.publishedAt);
    const h = hourInSaoPaulo(p.publishedAt);
    const b = bucketHour(h);
    const arr = bucketsByDay.get(day) ?? [];
    arr.push(b);
    bucketsByDay.set(day, arr);
  }

  const predominantBucketByDay = new Map<string, Bucket>();
  for (const [day, arr] of bucketsByDay.entries()) {
    const counts: Record<Bucket, number> = {
      madrugada: 0,
      manha: 0,
      tarde: 0,
      noite: 0,
    };
    for (const b of arr) counts[b]++;

    let best: Bucket = "manha";
    let bestN = -1;
    (Object.keys(counts) as Bucket[]).forEach((k) => {
      if (counts[k] > bestN) {
        bestN = counts[k];
        best = k;
      }
    });

    predominantBucketByDay.set(day, best);
  }

  const deltasByBucket: Record<Bucket, number[]> = {
    madrugada: [],
    manha: [],
    tarde: [],
    noite: [],
  };

  for (const [day, delta] of deltaByDay.entries()) {
    const b = predominantBucketByDay.get(day);
    if (!b) continue;
    deltasByBucket[b].push(delta);
  }

  const stats = (Object.keys(deltasByBucket) as Bucket[]).map((b) => {
    const arr = deltasByBucket[b];
    return { bucket: b, n: arr.length, avg: mean(arr) };
  });

  const viable = stats.filter((s) => s.n >= 3);
  if (viable.length < 2) {
    return {
      insights: [],
      debug: { reason: "INSUFFICIENT_BUCKET_VARIETY", stats },
    };
  }

  viable.sort((a, b) => b.avg - a.avg);
  const best = viable[0];
  const others = viable.slice(1);
  const othersAvg = mean(others.flatMap((o) => deltasByBucket[o.bucket]));

  const lift = best.avg - othersAvg;

  if (Math.abs(lift) < 2) {
    return {
      insights: [],
      debug: { reason: "NO_MEANINGFUL_LIFT", best, othersAvg, lift, stats },
    };
  }

  const confidence = clamp01((Math.abs(lift) / 10) * Math.min(1, best.n / 10));

  const insight: Insight = {
    id: crypto.randomUUID(),
    type: "posting_time_driver" as any,
    title: "Horário que tende a favorecer crescimento",
    message:
      lift > 0
        ? `Nos dias em que você postou principalmente na **${bucketLabel(best.bucket)}**, seu crescimento médio de seguidores foi maior (≈ +${best.avg.toFixed(
            1
          )}/dia) do que nos outros horários (≈ +${othersAvg.toFixed(1)}/dia).`
        : `Nos dias em que você postou principalmente na **${bucketLabel(best.bucket)}**, seu crescimento médio de seguidores foi menor (≈ +${best.avg.toFixed(
            1
          )}/dia) do que nos outros horários (≈ +${othersAvg.toFixed(1)}/dia).`,
    confidence,
    evidence: {
      timezone: "America/Sao_Paulo (aprox UTC-03)",
      bestBucket: best.bucket,
      bestAvgDelta: best.avg,
      bestSampleDays: best.n,
      othersAvgDelta: othersAvg,
      lift,
      stats,
    },
    actions:
      lift > 0
        ? [{ label: `Testar mais posts na ${bucketLabel(best.bucket)}`, reason: "Esse horário aparece associado a maior crescimento." }]
        : [{ label: "Ajustar horário de postagem", reason: "Este horário aparece associado a crescimento menor." }],
  };

  return {
    insights: [insight],
    debug: { stats, best, othersAvg, lift },
  };
}
