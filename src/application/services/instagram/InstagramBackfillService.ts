import { toFiniteNumber } from "../../../domain/metrics/instagram/instagramInsightsMapper";
import type {
  IInstagramBackfillService,
  BackfillDailyMetricsResult,
} from "../../interfaces/instagram/IInstagramBackfillService";
import type { IInstagramBackfillClient } from "../../interfaces/instagram/IInstagramBackfillClient";
import type { IInstagramDailyMetricsRepository } from "../../interfaces/instagram/IInstagramDailyMetricsRepository";

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function ymd(v: unknown): string {
  return s(v).slice(0, 10);
}

function dateOnlyUtcFromYmd(ymdStr: string): Date {
  return new Date(`${ymdStr.slice(0, 10)}T00:00:00.000Z`);
}

async function runPromisePool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  const queue = items.slice();
  const runners = new Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        await worker(item);
      }
    });

  await Promise.allSettled(runners);
}

export class InstagramBackfillService implements IInstagramBackfillService {
  constructor(
    private readonly client: IInstagramBackfillClient,
    private readonly dailyRepo: IInstagramDailyMetricsRepository
  ) {}

  async backfillDailyMetrics(args: {
    requestId?: string;
    userId: string;
    instagramAccountId: string;
    igUserId: string;
    pageAccessToken: string;
    days: string[];
    concurrency: number;
  }): Promise<BackfillDailyMetricsResult> {
    const userId = s(args.userId);
    const instagramAccountId = s(args.instagramAccountId);
    const igUserId = s(args.igUserId);
    const pageAccessToken = s(args.pageAccessToken);

    const days = Array.isArray(args.days) ? args.days.map(ymd) : [];
    const concurrency = Math.max(1, Number(args.concurrency ?? 2) || 2);

    if (!userId || !instagramAccountId || !igUserId || !pageAccessToken) {
      throw new Error("backfillDailyMetrics: parâmetros inválidos");
    }

    const errors: Array<{ day: string; message: string }> = [];
    let fetchedDays = 0;

    await runPromisePool(days, concurrency, async (dayYmd) => {
      try {
        const g = await this.client.getDailyInsights({
          igUserId,
          pageAccessToken,
          dayYmd,
          timeoutMs: 15000,
        });

        await this.dailyRepo.upsertDay({
          userId,
          instagramAccountId,
          day: dateOnlyUtcFromYmd(dayYmd),
          followers: null,
          profileViewsTotal: toFiniteNumber(g.profileViews),
          reach: toFiniteNumber(g.reach),
          totalInteractions: toFiniteNumber(g.totalInteractions),
        });

        fetchedDays++;
      } catch (e: unknown) {
        const err = e as any;
        errors.push({ day: dayYmd, message: String(err?.message ?? "erro") });
      }
    });

    return { fetchedDays, errors };
  }

  async getFollowersCountNow(args: {
    igUserId: string;
    pageAccessToken: string;
  }): Promise<number> {
    const igUserId = s(args.igUserId);
    const pageAccessToken = s(args.pageAccessToken);
    if (!igUserId || !pageAccessToken) return 0;

    try {
      const n = await this.client.getFollowersCountNow({
        igUserId,
        pageAccessToken,
        timeoutMs: 15000,
      });
      return toFiniteNumber(n);
    } catch {
      return 0;
    }
  }
}
