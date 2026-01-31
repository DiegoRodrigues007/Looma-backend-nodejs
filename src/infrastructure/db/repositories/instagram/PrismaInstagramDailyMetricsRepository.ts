import { prisma } from "../../prismaClient";
import type {
  IInstagramDailyMetricsRepository,
  InstagramDailyMetricRow,
} from "../../../../application/ports/db/IInstagramDailyMetricsRepository";

export class PrismaInstagramDailyMetricsRepository
  implements IInstagramDailyMetricsRepository
{
  async listByRange(args: {
    userId: string;
    instagramAccountId: string;
    from: Date;
    to: Date;
  }): Promise<InstagramDailyMetricRow[]> {
    const rows = await prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId: args.userId,
        instagramAccountId: args.instagramAccountId,
        day: {
          gte: args.from,
          lte: args.to,
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
}
