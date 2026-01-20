import type { BaselineStats } from "../../../domain/insights/calculators/baselineStats";
import { computeBaselineStats } from "../../../domain/insights/calculators/baselineStats";
import { hasCTAFromCaption } from "../../../domain/insights/calculators/ctaEffect";

export interface IPostInsightsProvider {
  fetchPostById(params: { accessToken: string; postId: string }): Promise<any | null>;

  fetchBaselineMedia(params: {
    accessToken: string;
    igUserId: string;
    from: string; 
    to: string;  
    limit: number;
  }): Promise<any[]>;
}

export type PostInsightRaw = {
  post: {
    id: string;
    timestamp: string;

    publishedHour: number;

    mediaType: string;
    caption: string;
    permalink?: string;

    reach: number;
    likes: number;
    comments: number;
    interactions: number;
    saves: number;
    shares: number;

    hasCTA: boolean;
  };

  baseline: BaselineStats;
};

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hourLocalSaoPaulo(iso: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const hh = parts.find((p) => p.type === "hour")?.value ?? "0";
  const n = Number(hh);
  return Number.isFinite(n) ? n : 0;
}

function ymdSaoPaulo(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const yyyy = parts.find((p) => p.type === "year")?.value ?? "1970";
  const mm = parts.find((p) => p.type === "month")?.value ?? "01";
  const dd = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${yyyy}-${mm}-${dd}`;
}

function startOfTodaySaoPaulo(): Date {
  const now = new Date();
  const ymd = ymdSaoPaulo(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}

function daysAgoSaoPaulo(days: number) {
  const today = startOfTodaySaoPaulo();
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function dedupById(items: any[]) {
  const map = new Map<string, any>();
  for (const m of items ?? []) map.set(String(m?.id), m);
  return Array.from(map.values());
}

function removeCurrentPost(items: any[], postId: string) {
  const pid = String(postId);
  return (items ?? []).filter((m) => String(m?.id) !== pid);
}

export class PostInsightDataService {
  constructor(private readonly provider: IPostInsightsProvider) {}

  async build(params: {
    accessToken: string;
    igUserId: string;
    postId: string;
    baselineDays: number;
  }): Promise<PostInsightRaw> {
    const { accessToken, igUserId, postId } = params;

    const baselineDaysInput = Math.min(
      Math.max(Math.floor(Number(params.baselineDays || 30)), 7),
      90
    );

    const post = await this.provider.fetchPostById({ accessToken, postId });
    if (!post) {
      const err: any = new Error("Post not found");
      err.statusCode = 404;
      throw err;
    }

    const caption = String(post?.caption ?? "");
    const likes = safeNum(post?.like_count);
    const comments = safeNum(post?.comments_count);
    const interactions = likes + comments;

    const reach = safeNum(post?.reach);
    const saves = safeNum(post?.saves);
    const shares = safeNum(post?.shares);

    const publishedHour = hourLocalSaoPaulo(String(post?.timestamp));
    const mediaType = String(post?.media_type ?? "UNKNOWN");
    const hasCTA = hasCTAFromCaption(caption);

    const toDate = startOfTodaySaoPaulo();
    const from1 = daysAgoSaoPaulo(baselineDaysInput);

    const desiredMinSample = 10;
    const maxHardDays = 90;

    const fetchWindow = async (from: Date, limit: number) => {
      const res = await this.provider.fetchBaselineMedia({
        accessToken,
        igUserId,
        from: ymdSaoPaulo(from),
        to: ymdSaoPaulo(toDate),
        limit,
      });
      return res ?? [];
    };

    let baselineMedia: any[] = [];
    baselineMedia = await fetchWindow(from1, 120);
    baselineMedia = dedupById(removeCurrentPost(baselineMedia, postId));

    const fallbackWindows = [45, 60, maxHardDays]
      .filter((d) => d > baselineDaysInput)
      .map((d) => Math.min(d, maxHardDays));

    for (const days of fallbackWindows) {
      if (baselineMedia.length >= desiredMinSample) break;

      const fromX = daysAgoSaoPaulo(days);
      const more = await fetchWindow(fromX, 200);

      baselineMedia = dedupById(removeCurrentPost(baselineMedia.concat(more), postId));
    }

    const normalized = (baselineMedia ?? []).map((m) => {
      const cap = String(m?.caption ?? "");
      const l = safeNum(m?.like_count);
      const c = safeNum(m?.comments_count);
      const inter = l + c;

      return {
        id: String(m?.id),
        ts: String(m?.timestamp),

        hour: hourLocalSaoPaulo(String(m?.timestamp)),
        mediaType: String(m?.media_type ?? "UNKNOWN"),
        hasCTA: hasCTAFromCaption(cap),

        reach: safeNum(m?.reach),
        likes: l,
        comments: c,
        interactions: inter,
        saves: safeNum(m?.saves),
        shares: safeNum(m?.shares),
      };
    });

    const baseline = computeBaselineStats(normalized);

    return {
      post: {
        id: String(post?.id),
        timestamp: String(post?.timestamp),
        publishedHour,
        mediaType,
        caption,
        permalink: post?.permalink,

        reach,
        likes,
        comments,
        interactions,
        saves,
        shares,

        hasCTA,
      },
      baseline,
    };
  }
}
