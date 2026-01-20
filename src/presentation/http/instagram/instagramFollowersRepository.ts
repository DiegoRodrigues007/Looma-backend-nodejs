import { prisma } from "../../../infrastructure/db/prismaClient";
import { ymd } from "./instagramDateUtils";

function dateOnlyUtcFromYmd(ymdStr: string) {
  const s = String(ymdStr ?? "").slice(0, 10);
  return new Date(`${s}T00:00:00.000Z`);
}

export async function getFollowersSeriesFromDb(params: {
  userId: string;
  instagramAccountId: string;
  from: string;
  to: string;
}): Promise<Record<string, number>> {
  const { userId, instagramAccountId, from, to } = params;

  const fromDate = dateOnlyUtcFromYmd(from);
  const toDate = dateOnlyUtcFromYmd(to);

  const rows = await prisma.instagramAccountDailyMetrics.findMany({
    where: {
      userId,
      instagramAccountId,
      day: {
        gte: fromDate,
        lte: toDate,
      },
    },
    orderBy: { day: "asc" },
    select: {
      day: true,
      followers: true,
    },
  });

  const result: Record<string, number> = {};
  for (const r of rows as any[]) {
    result[ymd(r.day as Date)] = Number(r.followers ?? 0);
  }

  return result;
}

export async function saveTodayFollowersSnapshot(params: {
  userId: string;
  instagramAccountId: string;
  followers: number;
}): Promise<void> {
  const { userId, instagramAccountId, followers } = params;

  const todayYmd = ymd(new Date());
  const day = dateOnlyUtcFromYmd(todayYmd);

  await prisma.instagramAccountDailyMetrics.upsert({
    where: {
      instagramAccountId_day: { instagramAccountId, day },
    },
    update: {
      followers: Number(followers ?? 0),
    },
    create: {
      userId,
      instagramAccountId,
      day,
      followers: Number(followers ?? 0),
      profileViewsTotal: 0,
      reach: 0,
      totalInteractions: 0,
    },
  });
}
