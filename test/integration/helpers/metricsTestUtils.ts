import axios from "axios";
import { prisma } from "../../../src/infrastructure/db/prismaClient";

type Ymd = string;

// ✅ Em testes de integração (supertest/express), NÃO use jest.useFakeTimers()
// Isso pode travar promises/IO e causar timeout/open handles.
// Aqui a gente “congela” o tempo mockando apenas Date.now().
let dateNowSpy: jest.SpyInstance<number, []> | null = null;

export function freezeTime(iso: string) {
  const fixed = new Date(iso).getTime();

  // se já estava mockado, restaura antes
  if (dateNowSpy) dateNowSpy.mockRestore();

  dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(fixed);
}

export function unfreezeTime() {
  if (dateNowSpy) {
    dateNowSpy.mockRestore();
    dateNowSpy = null;
  }
}

export function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function startOfDayUTC(d: Date) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function addDaysUTC(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

export async function seedMetricsSnapshots(params: {
  userId: string;
  platform?: "instagram";
  points: Array<{
    day: Ymd; // "YYYY-MM-DD"
    followers?: number;
    reach?: number;
    totalInteractions?: number;
    engagementRate?: number; // já é %
  }>;
}) {
  const platform = params.platform ?? "instagram";

  await prisma.metricsSnapshot.createMany({
    data: params.points.map((p) => ({
      userId: params.userId,
      platform,
      date: new Date(`${p.day}T00:00:00.000Z`),
      followers: p.followers ?? 0,
      reach: p.reach ?? 0,
      totalInteractions: p.totalInteractions ?? 0,
      engagementRate: p.engagementRate ?? 0,
    })),
  });
}

/**
 * Mock robusto pro InstagramMetricsService.fetchDailyMetrics
 * - Ele faz 3 GETs via axios:
 *   1) /{igUserId}?fields=followers_count
 *   2) /{igUserId}/insights?metric=reach&period=day
 *   3) /{igUserId}/insights?metric=total_interactions&period=day&metric_type=total_value
 */
export function mockAxiosGraphDailyMetrics(params: {
  followers: number;
  reach: number;
  totalInteractions: number;
}) {
  const ax = axios as unknown as { get: jest.Mock };

  ax.get.mockImplementation(async (url: string, config?: any) => {
    const metric = config?.params?.metric;

    // followers_count
    if (!String(url).includes("/insights")) {
      return { data: { followers_count: params.followers } };
    }

    if (metric === "reach") {
      return {
        data: {
          data: [{ name: "reach", values: [{ value: params.reach }] }],
        },
      };
    }

    if (metric === "total_interactions") {
      return {
        data: {
          data: [
            {
              name: "total_interactions",
              total_value: { value: params.totalInteractions },
            },
          ],
        },
      };
    }

    // fallback seguro
    return { data: { data: [] } };
  });
}

export function mockAxiosThrowAll() {
  const ax = axios as unknown as { get: jest.Mock };
  ax.get.mockRejectedValue(new Error("axios mocked error"));
}