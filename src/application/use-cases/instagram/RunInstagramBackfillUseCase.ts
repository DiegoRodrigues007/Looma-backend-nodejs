import { listDays, ymd } from "../../../shared/date/instagramDateUtils";
import { toFiniteNumber } from "../../../domain/metrics/instagram/instagramInsightsMapper";
import type { IUserRepository } from "../../ports/db/IUserRepository";
import type {
  IInstagramAccountRepository,
  InstagramAccountRecord,
} from "../../ports/db/IInstagramAccountRepository";
import type { IInstagramDailyMetricsRepository } from "../../ports/db/IInstagramDailyMetricsRepository";
import type { IMetricsSnapshotRepository } from "../../ports/db/IMetricsSnapshotRepository";
import type { IInstagramBackfillService } from "../../ports/instagram/IInstagramBackfillService";

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function dateOnlyUtcFromYmd(ymdStr: string): Date {
  return new Date(`${ymdStr.slice(0, 10)}T00:00:00.000Z`);
}

function clampRangeDays(from: string, to: string, maxDays = 92) {
  const days = listDays(from, to);
  if (days.length <= maxDays) return { days, from, to };
  const tail = days.slice(days.length - maxDays);
  return { days: tail, from: tail[0], to: tail[tail.length - 1] };
}

function isRowAllZero(r: {
  reach: number | null;
  profileViewsTotal: number | null;
  totalInteractions: number | null;
} | null | undefined): boolean {
  if (!r) return true;
  const reach = toFiniteNumber(r.reach);
  const pv = toFiniteNumber(r.profileViewsTotal);
  const ti = toFiniteNumber(r.totalInteractions);
  return reach === 0 && pv === 0 && ti === 0;
}

/* =========================
   Types
========================= */

export type RunInstagramBackfillParams = {
  requestId?: string;
  userId: string;
  instagramAccountId?: string | null; // se não vier, pega active ou primeira conectada
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  force?: boolean; // se true, refaz todos os dias do range
  refillZeros?: boolean; // se true, refaz dias zerados
  alwaysRefetchLastDays?: number; // default 7
  concurrency?: number; // default 2
};

export type RunInstagramBackfillResult = {
  ok: true;
  instagramAccountIdUsed: string;
  range: { from: string; to: string; days: number };
  plannedDays: number;
  fetchedDays: number;
  errorsCount: number;
  errorsPreview: Array<{ day: string; message: string }>;
  followersSnapshot?: { day: string; followers: number };
};

export class RunInstagramBackfillUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly instagramAccountRepo: IInstagramAccountRepository,
    private readonly dailyMetricsRepo: IInstagramDailyMetricsRepository,
    private readonly metricsSnapshotRepo: IMetricsSnapshotRepository,
    private readonly backfillService: IInstagramBackfillService
  ) {}

  async execute(params: RunInstagramBackfillParams): Promise<RunInstagramBackfillResult> {
    const requestId = s(params.requestId);
    const userId = s(params.userId);
    const from = s(params.from).slice(0, 10);
    const to = s(params.to).slice(0, 10);

    if (!userId) throw new Error("userId é obrigatório");
    if (!from || !to || from > to) throw new Error("Range inválido");

    const { days, from: safeFrom, to: safeTo } = clampRangeDays(from, to, 92);

    const alwaysRefetchLastDays = Math.max(
      0,
      Number(params.alwaysRefetchLastDays ?? 7) || 7
    );
    const concurrency = Math.max(1, Number(params.concurrency ?? 2) || 2);

    const lastDaysSet = new Set(
      days.slice(Math.max(0, days.length - alwaysRefetchLastDays))
    );

    // resolve account
    const activeId = await this.userRepo.getActiveInstagramAccountId(userId);
    const desiredAccountId = s(params.instagramAccountId ?? "") || s(activeId ?? "");

    const account: InstagramAccountRecord | null =
      (desiredAccountId
        ? await this.instagramAccountRepo.findConnectedById(userId, desiredAccountId)
        : null) || (await this.instagramAccountRepo.findLatestConnected(userId));

    if (!account) throw new Error("Conta do Instagram não encontrada");

    const instagramAccountIdUsed = account.id;
    const igUserId = s(account.igUserId);
    const pageAccessToken = s(account.pageAccessToken);

    if (!igUserId || !pageAccessToken) {
      throw new Error("Conta IG sem igUserId/pageAccessToken. Refaça a conexão.");
    }

    const force = !!params.force;
    const refillZeros = params.refillZeros ?? true;

    // load existing (via repo)
    const existing = await this.dailyMetricsRepo.listByRange({
      userId,
      instagramAccountId: instagramAccountIdUsed,
      from: dateOnlyUtcFromYmd(safeFrom),
      to: dateOnlyUtcFromYmd(safeTo),
    });

    const byDayExisting = new Map<string, (typeof existing)[number]>();
    for (const r of existing) byDayExisting.set(ymd(r.day), r);

    const daysToFetch = force
      ? [...days]
      : days.filter((d) => {
          const r = byDayExisting.get(d);
          if (!r) return true;
          if (lastDaysSet.has(d)) return true;
          if (!refillZeros) return false;
          return isRowAllZero(r);
        });

    // backfill + persist (infra service)
    const backfill = daysToFetch.length
      ? await this.backfillService.backfillDailyMetrics({
          requestId,
          userId,
          instagramAccountId: instagramAccountIdUsed,
          igUserId,
          pageAccessToken,
          days: daysToFetch,
          concurrency,
        })
      : { fetchedDays: 0, errors: [] as Array<{ day: string; message: string }> };

    // followers snapshot (TOTAL real) para o dia safeTo
    const followersNow = await this.backfillService.getFollowersCountNow({
      igUserId,
      pageAccessToken,
    });

    await this.metricsSnapshotRepo.upsertFollowersSnapshot({
      userId,
      platform: "instagram",
      date: dateOnlyUtcFromYmd(safeTo),
      followers: Math.trunc(toFiniteNumber(followersNow)),
    });

    return {
      ok: true,
      instagramAccountIdUsed,
      range: { from: safeFrom, to: safeTo, days: days.length },
      plannedDays: daysToFetch.length,
      fetchedDays: backfill.fetchedDays,
      errorsCount: backfill.errors.length,
      errorsPreview: backfill.errors.slice(0, 10),
      followersSnapshot: { day: safeTo, followers: Math.trunc(toFiniteNumber(followersNow)) },
    };
  }
}
