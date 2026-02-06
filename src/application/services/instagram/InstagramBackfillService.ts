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

function ymdTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function ymdAddDaysUtc(ymdStr: string, days: number): string {
  const d = new Date(`${ymdStr.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isPrevDayUtc(prev: string, next: string): boolean {
  // prev + 1 == next
  return ymdAddDaysUtc(prev, 1) === next;
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

/**
 * 🔥 Forma correta (sem inventar dados):
 * - Followers por dia só é preenchido quando a Meta devolver histórico (até 30d).
 * - Se não tiver dado daquele dia => followers: null (controller já devolve null).
 *
 * Estratégia:
 * 1) Tenta buscar "follows_and_unfollows" (30d) uma única vez
 * 2) Pega o total atual (followersCountNow) como âncora do dia "hoje"
 * 3) Reconstrói followers total por dia voltando no tempo APENAS onde houver sequência diária
 * 4) No upsert de cada dia, salva followers quando existir no map; caso contrário, null
 */
export class InstagramBackfillService implements IInstagramBackfillService {
  constructor(
    private readonly client: IInstagramBackfillClient,
    private readonly dailyRepo: IInstagramDailyMetricsRepository
  ) {}

  /**
   * Monta um Map<YYYY-MM-DD, followersTotal> usando:
   * - totalFollowersNow (âncora)
   * - follows/unfollows diário (net = follows - unfollows)
   *
   * Observações honestas:
   * - Só ancora se o último dia do histórico for "hoje" (UTC). Se não for, não preenche followers.
   * - Só reconstrói para trás enquanto os dias forem consecutivos (sem gap).
   */
  private async buildFollowersByDayFromMeta(opts: {
    igUserId: string;
    pageAccessToken: string;
  }): Promise<Map<string, number>> {
    const igUserId = s(opts.igUserId);
    const pageAccessToken = s(opts.pageAccessToken);

    const out = new Map<string, number>();

    // 1) total atual
    const totalNow = await this.getFollowersCountNow({ igUserId, pageAccessToken });
    if (!Number.isFinite(totalNow) || totalNow <= 0) return out;

    // 2) tenta buscar histórico 30d (follows/unfollows)
    // NOTE: não quebra tipagem se sua interface ainda não declara o método.
    const anyClient = this.client as any;

    if (typeof anyClient?.getFollowsAndUnfollowsLast30Days !== "function") {
      // sem suporte no client -> não preenche followers por dia (fica null)
      return out;
    }

    type MetaFU = { date: string; follows?: unknown; unfollows?: unknown };

    let series: MetaFU[] = [];
    try {
      series = await anyClient.getFollowsAndUnfollowsLast30Days({
        igUserId,
        pageAccessToken,
        timeoutMs: 15000,
      });
    } catch {
      return out;
    }

    if (!Array.isArray(series) || series.length === 0) return out;

    // normaliza + ordena por data
    const normalized = series
      .map((x) => ({
        date: ymd(x?.date),
        follows: toFiniteNumber((x as any)?.follows),
        unfollows: toFiniteNumber((x as any)?.unfollows),
      }))
      .filter((x) => !!x.date)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (normalized.length === 0) return out;

    // precisa ancorar no "hoje" (UTC) pra ser correto
    const today = ymdTodayUtc();
    const lastDay = normalized[normalized.length - 1]?.date;

    if (lastDay !== today) {
      // ✅ forma correta: não inventa followers se não dá pra ancorar com segurança
      // (você pode logar isso se quiser)
      return out;
    }

    // âncora: followers total no dia "hoje"
    out.set(today, totalNow);

    // reconstrói pra trás somente se dias forem consecutivos
    for (let i = normalized.length - 1; i >= 1; i--) {
      const cur = normalized[i];
      const prev = normalized[i - 1];

      if (!cur?.date || !prev?.date) break;
      if (!isPrevDayUtc(prev.date, cur.date)) {
        // tem gap -> para (não dá pra garantir)
        break;
      }

      const curFollowers = out.get(cur.date);
      if (typeof curFollowers !== "number") break;

      const netCur = toFiniteNumber(cur.follows) - toFiniteNumber(cur.unfollows);
      const prevFollowers = curFollowers - netCur;

      // só salva se plausível
      if (Number.isFinite(prevFollowers) && prevFollowers >= 0) {
        out.set(prev.date, prevFollowers);
      } else {
        break;
      }
    }

    return out;
  }

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

    // ✅ tenta preparar followers por dia (até 30d) uma vez (barato)
    // Se falhar/não suportar => map vazio => followers fica null (correto)
    const followersByDay = await this.buildFollowersByDayFromMeta({
      igUserId,
      pageAccessToken,
    });

    await runPromisePool(days, concurrency, async (dayYmd) => {
      try {
        const g = await this.client.getDailyInsights({
          igUserId,
          pageAccessToken,
          dayYmd,
          timeoutMs: 15000,
        });

        const followersForDay =
          followersByDay.has(dayYmd) ? followersByDay.get(dayYmd)! : null;

        await this.dailyRepo.upsertDay({
          userId,
          instagramAccountId,
          day: dateOnlyUtcFromYmd(dayYmd),

          // ✅ forma correta:
          // - se tiver histórico (30d) e conseguimos reconstruir => número
          // - se não tiver dado => null (não inventa)
          followers: followersForDay,

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
