import { prisma } from "../../prismaClient";
import type {
  IInstagramDailyMetricsRepository,
  InstagramDailyMetricRow,
  ListInstagramDailyMetricsByRangeInput,
  UpsertInstagramDailyMetricInput,
} from "../../../../application/interfaces/instagram/IInstagramDailyMetricsRepository";

function toDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function ymdToDateUtc(ymd: string): Date {
  return new Date(`${ymd.slice(0, 10)}T00:00:00.000Z`);
}

function isYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function safeInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * ✅ IMPORTANTE:
 * Para "reach/profileViews/totalInteractions" faz sentido salvar 0 quando não tem dado.
 * Para "followers" NÃO:
 * - followers precisa ser null quando não existe registro daquele dia (não inventar).
 * Então aqui mantemos followers como null quando vier null/undefined.
 */
function numOrZero(v: number | null | undefined): number {
  return v == null ? 0 : safeInt(v);
}

function numOrNull(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export class PrismaInstagramDailyMetricsRepository
  implements IInstagramDailyMetricsRepository
{
  async listByRange(
    args: ListInstagramDailyMetricsByRangeInput
  ): Promise<InstagramDailyMetricRow[]> {
    const from = toDayUtc(args.from);
    const to = toDayUtc(args.to);

    const rows = await prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId: args.userId,
        instagramAccountId: args.instagramAccountId,
        day: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { day: "asc" },
      select: {
        day: true,
        followers: true,
        reach: true,
        profileViewsTotal: true,
        totalInteractions: true,
      },
    });

    return rows.map((r) => ({
      day: r.day,
      followers: r.followers ?? null,
      reach: r.reach ?? null,
      profileViewsTotal: r.profileViewsTotal ?? null,
      totalInteractions: r.totalInteractions ?? null,
    }));
  }

  async upsertDay(input: UpsertInstagramDailyMetricInput): Promise<void> {
    const day = toDayUtc(input.day);

    // ✅ métricas numéricas: 0 quando vier null/undefined (ok)
    const reach = numOrZero(input.reach);
    const profileViewsTotal = numOrZero(input.profileViewsTotal);
    const totalInteractions = numOrZero(input.totalInteractions);

    // ✅ followers: mantém null quando não tiver dado (correto)
    const followers = numOrNull(input.followers);

    await prisma.instagramAccountDailyMetrics.upsert({
      where: {
        instagramAccountId_day: {
          instagramAccountId: input.instagramAccountId,
          day,
        },
      },
      create: {
        userId: input.userId,
        instagramAccountId: input.instagramAccountId,
        day,
        followers,
        reach,
        profileViewsTotal,
        totalInteractions,
      },
      update: {
        followers,
        reach,
        profileViewsTotal,
        totalInteractions,
      },
    });
  }

  /**
   * Compat para chamadas antigas:
   * - aceita day como Date ou "YYYY-MM-DD"
   */
  async upsertDayCompat(args: {
    userId: string;
    instagramAccountId: string;
    day: Date | string;
    followers: number | null;
    reach: number | null;
    profileViewsTotal: number | null;
    totalInteractions: number | null;
  }): Promise<void> {
    const day: Date = isYmd(args.day) ? ymdToDateUtc(args.day) : toDayUtc(args.day);

    await this.upsertDay({
      userId: args.userId,
      instagramAccountId: args.instagramAccountId,
      day,
      followers: args.followers,
      reach: args.reach,
      profileViewsTotal: args.profileViewsTotal,
      totalInteractions: args.totalInteractions,
    });
  }
}
