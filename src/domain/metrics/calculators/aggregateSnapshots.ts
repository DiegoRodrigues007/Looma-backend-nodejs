import { MetricsSnapshot, MetricsPlatform } from "../../entities/MetricsSnapshot";

type Totals = {
  followers: number;
  reach: number;
  totalInteractions: number;
  engagementRate: number;
};

/**
 * Faz agregação (média) de snapshots e devolve um MetricsSnapshot "médio".
 * - followers/reach/interactions: arredonda (igual ao código original)
 * - engagementRate: média simples (sem round)
 */
export function aggregateSnapshotsAverage(params: {
  userId: string;
  platform: MetricsPlatform;
  date: Date; 
  data: MetricsSnapshot[];
}): MetricsSnapshot | null {
  const { userId, platform, date, data } = params;

  if (!data || data.length === 0) return null;

  const total = data.reduce(
    (acc: Totals, d: MetricsSnapshot) => {
      acc.followers += Number(d.followers ?? 0);
      acc.reach += Number(d.reach ?? 0);
      acc.totalInteractions += Number(d.totalInteractions ?? 0);
      acc.engagementRate += Number(d.engagementRate ?? 0);
      return acc;
    },
    { followers: 0, reach: 0, totalInteractions: 0, engagementRate: 0 }
  );

  const count = data.length;

  return new MetricsSnapshot(
    userId,
    platform,
    date,
    Math.round(total.followers / count),
    Math.round(total.reach / count),
    Math.round(total.totalInteractions / count),
    total.engagementRate / count
  );
}
