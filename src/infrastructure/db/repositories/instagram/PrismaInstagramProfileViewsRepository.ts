// src/presentation/http/instagram/instagramProfileViewsRepository.ts
import { prisma } from "../../prismaClient";
import { ymd, listDays } from "../../../../shared/date/instagramDateUtils";

function dateOnlyUtcFromYmd(ymdStr: string) {
  const s = String(ymdStr ?? "").slice(0, 10);
  return new Date(`${s}T00:00:00.000Z`);
}

/**
 * ✅ Agora salva na tabela única:
 * InstagramAccountDailyMetrics (instagramAccountId + day)
 *
 * profileViewsTotal = total acumulado do dia (como vem do IG)
 * ⚠️ NÃO sobrescreve reach/totalInteractions/followers
 */
export async function saveTodayProfileViewsSnapshot(opts: {
  userId: string;
  instagramAccountId: string;
  day?: Date;
  total: number;
}) {
  const { userId, instagramAccountId } = opts;
  const total = Number(opts.total ?? 0);

  const dayStr = ymd(opts.day ?? new Date());
  const day = dateOnlyUtcFromYmd(dayStr);

  await prisma.instagramAccountDailyMetrics.upsert({
    where: {
      instagramAccountId_day: { instagramAccountId, day },
    },
    update: {
      profileViewsTotal: total,
      // não mexe no resto
    },
    create: {
      userId,
      instagramAccountId,
      day,
      followers: 0,
      profileViewsTotal: total,
      reach: 0,
      totalInteractions: 0,
    },
  });
}

/**
 * ✅ Série diária (YYYY-MM-DD -> profileViewsTotal)
 * - Lê da tabela única (day é Date)
 * - Preenche dias faltantes com 0
 */
export async function getProfileViewsSeriesFromDb(opts: {
  userId: string;
  instagramAccountId: string;
  from: string;
  to: string;
}): Promise<Record<string, number>> {
  const { userId, instagramAccountId, from, to } = opts;

  const days = listDays(from, to);

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
    select: { day: true, profileViewsTotal: true },
  });

  const map: Record<string, number> = {};

  for (const r of rows as any[]) {
    map[ymd(r.day as Date)] = Number(r.profileViewsTotal ?? 0);
  }

  for (const d of days) {
    if (map[d] == null) map[d] = 0;
  }

  return map;
}
