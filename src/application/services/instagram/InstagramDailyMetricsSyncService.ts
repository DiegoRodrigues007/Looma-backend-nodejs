import type { IInstagramDailyMetricsClient } from "../../../application/interfaces/instagram/IInstagramDailyMetricsClient";
import type { IInstagramDailyMetricsRepository } from "../../../application/interfaces/instagram/IInstagramDailyMetricsRepository";
import type { IInstagramAccountResolver } from "../../../application/interfaces/instagram/IInstagramAccountResolver";

function s(v: unknown) {
  return String(v ?? "").trim();
}

function ymd(v: unknown) {
  return s(v).slice(0, 10);
}

function safeInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function isValidYmd(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function addDaysYmd(ymdStr: string, days: number) {
  const d = new Date(`${ymdStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function compareYmd(a: string, b: string) {
  return a.localeCompare(b);
}

function parseYmdToUtcDate(ymdStr: string) {
  return new Date(`${ymdStr}T00:00:00.000Z`);
}

type UpsertPayload = {
  userId: string;
  instagramAccountId: string;
  dayYmd: string; // YYYY-MM-DD
  followers: number;
  reach: number;
  profileViewsTotal: number;
  totalInteractions: number;
};

export class InstagramDailyMetricsSyncService {
  constructor(
    private readonly accountResolver: IInstagramAccountResolver,
    private readonly client: IInstagramDailyMetricsClient,
    private readonly repo: IInstagramDailyMetricsRepository,
  ) {}

  private async persistDay(payload: UpsertPayload) {
    const repoAny = this.repo as any;

    if (typeof repoAny.upsertDay === "function") {
      return repoAny.upsertDay({
        userId: payload.userId,
        instagramAccountId: payload.instagramAccountId,
        day: parseYmdToUtcDate(payload.dayYmd),
        followers: payload.followers,
        reach: payload.reach,
        profileViewsTotal: payload.profileViewsTotal,
        totalInteractions: payload.totalInteractions,
      });
    }

    if (typeof repoAny.upsertDayCompat === "function") {
      return repoAny.upsertDayCompat({
        userId: payload.userId,
        instagramAccountId: payload.instagramAccountId,
        day: payload.dayYmd,
        followers: payload.followers,
        reach: payload.reach,
        profileViewsTotal: payload.profileViewsTotal,
        totalInteractions: payload.totalInteractions,
      });
    }

    throw new Error(
      "IInstagramDailyMetricsRepository: nenhum método de upsert disponível (esperado: upsertDay ou upsertDayCompat)",
    );
  }

  async syncDayForAccount(params: {
    userId: string;
    instagramAccountId: string;
    igUserId: string;
    pageAccessToken: string;
    dayYmd: string;
  }) {
    const userId = s(params.userId);
    const instagramAccountId = s(params.instagramAccountId);
    const igUserId = s(params.igUserId);
    const pageAccessToken = s(params.pageAccessToken);
    const dayYmdStr = ymd(params.dayYmd);

    if (
      !userId ||
      !instagramAccountId ||
      !igUserId ||
      !pageAccessToken ||
      !dayYmdStr
    ) {
      throw new Error("syncDayForAccount: parâmetros inválidos");
    }
    if (!isValidYmd(dayYmdStr)) {
      throw new Error("syncDayForAccount: dayYmd inválido (use YYYY-MM-DD)");
    }

    const [followersRaw, insights] = await Promise.all([
      this.client.getFollowersCount({
        igUserId,
        accessToken: pageAccessToken,
        timeoutMs: 15000,
      }),
      this.client.getInsightsForDay({
        igUserId,
        accessToken: pageAccessToken,
        dayYmd: dayYmdStr,
        timeoutMs: 20000,
      }),
    ]);

    const followers = safeInt(followersRaw);

    const reach = safeInt(insights.reach);
    const profileViewsTotal = safeInt(insights.profileViews);

    const totalInteractions = safeInt(insights.accountsEngaged);

    await this.persistDay({
      userId,
      instagramAccountId,
      dayYmd: dayYmdStr,
      followers,
      reach,
      profileViewsTotal,
      totalInteractions,
    });

    return {
      ok: true as const,
      day: dayYmdStr,
      followers,
      reach,
      profileViews: profileViewsTotal,
      accountsEngaged: safeInt(insights.accountsEngaged),
      totalInteractions,
    };
  }

  async syncRangeForUserActiveAccount(params: {
    userId: string;
    from: string;
    to: string;
  }) {
    const userId = s(params.userId);
    const from = ymd(params.from);
    const to = ymd(params.to);

    if (!userId)
      throw new Error("syncRangeForUserActiveAccount: userId inválido");
    if (!isValidYmd(from) || !isValidYmd(to))
      throw new Error("from/to inválidos (YYYY-MM-DD)");

    if (compareYmd(from, to) > 0) {
      throw new Error("from não pode ser maior que to");
    }

    const account =
      await this.accountResolver.getActiveOrLatestConnectedAccount(userId);

    if (!account?.id || !account?.igUserId || !account?.pageAccessToken) {
      throw new Error(
        "Conta ativa não encontrada ou sem igUserId/pageAccessToken",
      );
    }

    const days: string[] = [];
    for (let cur = from; compareYmd(cur, to) <= 0; cur = addDaysYmd(cur, 1)) {
      days.push(cur);
    }

    const results: any[] = [];
    for (const dayYmdStr of days) {
      results.push(
        await this.syncDayForAccount({
          userId,
          instagramAccountId: account.id,
          igUserId: account.igUserId,
          pageAccessToken: account.pageAccessToken,
          dayYmd: dayYmdStr,
        }),
      );
    }

    return {
      ok: true as const,
      instagramAccountId: account.id,
      totalDays: days.length,
      results,
    };
  }
}
