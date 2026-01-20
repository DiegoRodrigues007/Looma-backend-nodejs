import axios from "axios";
import { prisma } from "../../infrastructure/db/prismaClient";

function toUnixStartOfDayUTC(ymd: string) {
  return Math.floor(new Date(`${ymd}T00:00:00.000Z`).getTime() / 1000);
}
function toUnixEndOfDayUTC(ymd: string) {
  return Math.floor(new Date(`${ymd}T23:59:59.999Z`).getTime() / 1000);
}

function s(v: any) {
  return String(v ?? "").trim();
}

function toInt(v: any): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  if (v && typeof v === "object" && "value" in v) return toInt((v as any).value);
  return 0;
}

type DailyGraphMetrics = {
  reach: number;
  profileViews: number;
  accountsEngaged: number; // vamos usar como totalInteractions (melhor métrica de “interações” em nível de conta)
  followers: number;
};

export class InstagramDailyMetricsSyncService {
  private readonly baseUrl = process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";

  private async fetchFollowers(igUserId: string, pageAccessToken: string): Promise<number> {
    // followers_count costuma funcionar para Professional accounts via IG Graph
    const url = `${this.baseUrl}/${encodeURIComponent(igUserId)}`;
    const { data } = await axios.get(url, {
      params: {
        fields: "followers_count",
        access_token: pageAccessToken,
      },
      timeout: 15000,
    });

    return toInt(data?.followers_count);
  }

  private async fetchInsightsDay(
    igUserId: string,
    pageAccessToken: string,
    ymd: string
  ): Promise<{ reach: number; profileViews: number; accountsEngaged: number }> {
    const url = `${this.baseUrl}/${encodeURIComponent(igUserId)}/insights`;

    // Graph costuma aceitar since/until em unix seconds com period=day
    const since = toUnixStartOfDayUTC(ymd);
    const until = toUnixEndOfDayUTC(ymd);

    const { data } = await axios.get(url, {
      params: {
        metric: "reach,profile_views,accounts_engaged",
        period: "day",
        since,
        until,
        access_token: pageAccessToken,
      },
      timeout: 20000,
    });

    const rows: any[] = Array.isArray(data?.data) ? data.data : [];

    const getMetricValue = (name: string) => {
      const m = rows.find((x) => x?.name === name);
      const v0 = Array.isArray(m?.values) ? m.values[0]?.value : undefined;
      return toInt(v0);
    };

    return {
      reach: getMetricValue("reach"),
      profileViews: getMetricValue("profile_views"),
      accountsEngaged: getMetricValue("accounts_engaged"),
    };
  }

  async syncDayForAccount(params: {
    userId: string;
    instagramAccountId: string;
    igUserId: string;
    pageAccessToken: string;
    dayYmd: string; // "2026-01-19"
  }) {
    const userId = s(params.userId);
    const instagramAccountId = s(params.instagramAccountId);
    const igUserId = s(params.igUserId);
    const pageAccessToken = s(params.pageAccessToken);
    const dayYmd = s(params.dayYmd).slice(0, 10);

    if (!userId || !instagramAccountId || !igUserId || !pageAccessToken || !dayYmd) {
      throw new Error("syncDayForAccount: parâmetros inválidos");
    }

    const [followers, insights] = await Promise.all([
      this.fetchFollowers(igUserId, pageAccessToken),
      this.fetchInsightsDay(igUserId, pageAccessToken, dayYmd),
    ]);

    const day = new Date(`${dayYmd}T00:00:00.000Z`);

    await prisma.instagramAccountDailyMetrics.upsert({
      where: {
        instagramAccountId_day: {
          instagramAccountId,
          day,
        },
      },
      create: {
        userId,
        instagramAccountId,
        day,
        followers,
        reach: insights.reach,
        profileViewsTotal: insights.profileViews,
        totalInteractions: insights.accountsEngaged,
      },
      update: {
        followers,
        reach: insights.reach,
        profileViewsTotal: insights.profileViews,
        totalInteractions: insights.accountsEngaged,
      },
    });

    return { ok: true, day: dayYmd, followers, ...insights };
  }

  async syncRangeForUserActiveAccount(params: { userId: string; from: string; to: string }) {
    const userId = s(params.userId);
    const from = s(params.from).slice(0, 10);
    const to = s(params.to).slice(0, 10);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeInstagramAccountId: true },
    });

    const account =
      (user?.activeInstagramAccountId
        ? await prisma.instagramAccount.findFirst({
            where: { id: user.activeInstagramAccountId, userId, isConnected: true },
            select: { id: true, igUserId: true, pageAccessToken: true },
          })
        : null) ||
      (await prisma.instagramAccount.findFirst({
        where: { userId, isConnected: true },
        orderBy: { updatedAt: "desc" },
        select: { id: true, igUserId: true, pageAccessToken: true },
      }));

    if (!account?.id || !account?.igUserId || !account?.pageAccessToken) {
      throw new Error("Conta ativa não encontrada ou sem igUserId/pageAccessToken");
    }

    // gera lista de dias
    const days: string[] = [];
    for (let d = new Date(`${from}T00:00:00.000Z`); d <= new Date(`${to}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }

    const results = [];
    for (const dayYmd of days) {
      results.push(
        await this.syncDayForAccount({
          userId,
          instagramAccountId: account.id,
          igUserId: account.igUserId,
          pageAccessToken: account.pageAccessToken,
          dayYmd,
        })
      );
    }

    return { ok: true, instagramAccountId: account.id, totalDays: days.length, results };
  }
}
