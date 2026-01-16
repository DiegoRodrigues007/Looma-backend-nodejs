import { prisma } from "../../../infrastructure/db/prismaClient";
import { ymd } from "./instagramDateUtils";

function dayStartUtc(ymdStr: string) {
  return new Date(`${ymdStr}T00:00:00.000Z`);
}

function dayEndUtc(ymdStr: string) {
  return new Date(`${ymdStr}T23:59:59.999Z`);
}


export async function getFollowersSeriesFromDb(params: {
  userId: string;
  igUserId: string;
  from: string; 
  to: string; 
}): Promise<Record<string, number>> {
  const { userId, igUserId, from, to } = params;

  const rows = await prisma.instagramFollowersDaily.findMany({
    where: {
      userId,
      igUserId,
      day: {
        gte: dayStartUtc(from),
        lte: dayEndUtc(to),
      },
    },
    orderBy: { day: "asc" },
  });

  const result: Record<string, number> = {};
  for (const r of rows) {
    result[ymd(r.day)] = r.followers;
  }

  return result;
}

export async function saveTodayFollowersSnapshot(params: {
  userId: string;
  igUserId: string;
  followers: number;
}): Promise<void> {
  const { userId, igUserId, followers } = params;

  const today = ymd(new Date());
  const day = dayStartUtc(today);

  const existing = await prisma.instagramFollowersDaily.findFirst({
    where: { userId, igUserId, day },
    select: { id: true },
  });

  if (existing) {
    await prisma.instagramFollowersDaily.update({
      where: { id: existing.id },
      data: { followers },
    });
    return;
  }

  await prisma.instagramFollowersDaily.create({
    data: {
      userId,
      igUserId,
      day,
      followers,
    },
  });
}
