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

type ContentType = "reel" | "carousel" | "feed" | "unknown";

function normalizeMediaType(raw?: string | null): ContentType {
  const v = String(raw ?? "").toUpperCase().trim();
  if (v.includes("REEL")) return "reel";
  if (v.includes("CAROUSEL") || v.includes("ALBUM")) return "carousel";
  if (v.includes("IMAGE") || v.includes("PHOTO")) return "feed";
  if (v.includes("VIDEO")) return "feed"; 
  return "unknown";
}

function label(t: ContentType) {
  if (t === "reel") return "Reels";
  if (t === "carousel") return "Carrossel";
  if (t === "feed") return "Feed";
  return "Conteúdo";
}

export async function contentTypeEngine(args: {
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
    select: { publishedAt: true, mediaType: true },
  });

  if (posts.length < 8) {
    return { insights: [], debug: { reason: "INSUFFICIENT_POSTS", posts: posts.length } };
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

  const deltas: { day: string; delta: number }[] = [];
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
    deltas.push({ day, delta: fToday - fPrev });
  }

  if (deltas.length < 6) {
    return { insights: [], debug: { reason: "INSUFFICIENT_FOLLOWERS_SERIES", days: deltas.length } };
  }

  const typesByDay = new Map<string, Set<ContentType>>();
  for (const p of posts) {
    const day = ymdUtcKey(p.publishedAt);
    const t = normalizeMediaType(p.mediaType);
    const set = typesByDay.get(day) ?? new Set<ContentType>();
    set.add(t);
    typesByDay.set(day, set);
  }

  const candidates: ContentType[] = ["reel", "carousel", "feed"];

  let best: {
    type: ContentType;
    withAvg: number;
    withoutAvg: number;
    lift: number;
    withN: number;
    withoutN: number;
  } | null = null;

  for (const t of candidates) {
    const withType: number[] = [];
    const withoutType: number[] = [];

    for (const d of deltas) {
      const set = typesByDay.get(d.day);
      if (set && set.has(t)) withType.push(d.delta);
      else withoutType.push(d.delta);
    }

    if (withType.length < 3 || withoutType.length < 3) continue;

    const a = mean(withType);
    const b = mean(withoutType);
    const lift = a - b;

    const candidate = { type: t, withAvg: a, withoutAvg: b, lift, withN: withType.length, withoutN: withoutType.length };
    if (!best || Math.abs(candidate.lift) > Math.abs(best.lift)) best = candidate;
  }

  if (!best) {
    return { insights: [], debug: { reason: "NO_VIABLE_TYPE_SPLIT" } };
  }

  if (Math.abs(best.lift) < 2) {
    return { insights: [], debug: { reason: "NO_MEANINGFUL_LIFT", best } };
  }

  const confidence = clamp01((Math.abs(best.lift) / 10) * Math.min(1, best.withN / 10));

  const insight: Insight = {
    id: crypto.randomUUID(),
    type: "content_type_driver" as any,
    title: "Tipo de conteúdo associado ao crescimento",
    message:
      best.lift > 0
        ? `Nos dias com **${label(best.type)}**, seu crescimento médio foi maior (≈ +${best.withAvg.toFixed(1)}/dia) do que em dias sem esse tipo (≈ +${best.withoutAvg.toFixed(1)}/dia).`
        : `Nos dias com **${label(best.type)}**, seu crescimento médio foi menor (≈ +${best.withAvg.toFixed(1)}/dia) do que em dias sem esse tipo (≈ +${best.withoutAvg.toFixed(1)}/dia).`,
    confidence,
    evidence: best,
    actions:
      best.lift > 0
        ? [{ label: `Aumentar a proporção de ${label(best.type)}`, reason: "Esse tipo apareceu associado a mais crescimento." }]
        : [{ label: `Rever estratégia de ${label(best.type)}`, reason: "Esse tipo apareceu associado a menor crescimento." }],
  };

  return { insights: [insight], debug: { best } };
}
