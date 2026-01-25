// src/application/services/instagram/InstagramFollowersMetricsService.ts
import type { PrismaClient } from "@prisma/client";

export type InstagramFollowersMetrics = {
  /** Total de seguidores (snapshot) no dia "to" */
  total: number;
  /** Quantos ganhou no dia (diferença positiva vs dia anterior) */
  gained: number;
  /** Quantos perdeu no dia (diferença negativa vs dia anterior) */
  lost: number;

  /** Debug útil */
  day: string; // YYYY-MM-DD (to)
  prevDay: string; // YYYY-MM-DD (to-1)
  totalPrevDay: number;
};

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function toFiniteInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  // followers é Int no schema
  return Math.trunc(n);
}

function ymd(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateOnlyUtcFromYmd(ymdStr: string): Date {
  return new Date(`${ymdStr.slice(0, 10)}T00:00:00.000Z`);
}

function addDaysYmd(day: string, deltaDays: number): string {
  const d = dateOnlyUtcFromYmd(day);
  const x = new Date(d.getTime() + deltaDays * 86400 * 1000);
  return ymd(x);
}

export class InstagramFollowersMetricsService {
  constructor(private readonly prisma: PrismaClient) {}

  async getFollowersMetrics(args: {
    userId: string;
    to: string; // YYYY-MM-DD
  }): Promise<InstagramFollowersMetrics> {
    const userId = s(args.userId);
    const day = s(args.to).slice(0, 10);

    if (!userId) throw new Error("userId é obrigatório");
    if (!day) throw new Error("to (YYYY-MM-DD) é obrigatório");

    const prevDay = addDaysYmd(day, -1);

    const [snapTo, snapPrev] = await Promise.all([
      this.prisma.metricsSnapshot.findUnique({
        where: {
          userId_platform_date: {
            userId,
            platform: "instagram",
            date: dateOnlyUtcFromYmd(day),
          },
        },
        select: { followers: true },
      }),
      this.prisma.metricsSnapshot.findUnique({
        where: {
          userId_platform_date: {
            userId,
            platform: "instagram",
            date: dateOnlyUtcFromYmd(prevDay),
          },
        },
        select: { followers: true },
      }),
    ]);

    const total = toFiniteInt(snapTo?.followers ?? 0);
    const totalPrevDay = toFiniteInt(snapPrev?.followers ?? 0);

    const diff = total - totalPrevDay;

    return {
      total,
      gained: diff > 0 ? diff : 0,
      lost: diff < 0 ? Math.abs(diff) : 0,
      day,
      prevDay,
      totalPrevDay,
    };
  }
}
