import { compareKpi } from "./compareKpi";
import { compareEngagement } from "./compareEngagement";
import { normalizePercent } from "./normalizePercent";
import { KpiComparativeDTO } from "../../../application/dto/metrics/KpiComparativeDTO";

export interface MetricsSnapshot {
  followers: number;
  reach: number;
  totalInteractions: number;
  engagementRate: number;
}

export interface MetricsOverview {
  followers: KpiComparativeDTO;
  reach: KpiComparativeDTO;
  interactions: KpiComparativeDTO;
  engagement: KpiComparativeDTO;
}

export function buildKpis(
  current: MetricsSnapshot,
  previous: MetricsSnapshot
): MetricsOverview {
  const followersBase = compareKpi(
    "Seguidores",
    current.followers,
    previous.followers
  );

  const followersDelta = Number(followersBase.delta ?? 0);

  const followers: KpiComparativeDTO = {
    ...followersBase,
    gained: followersDelta > 0 ? followersDelta : 0,
    lost: followersDelta < 0 ? Math.abs(followersDelta) : 0,
  };

  const reach = compareKpi("Alcance", current.reach, previous.reach);

  const interactions = compareKpi(
    "Interações",
    current.totalInteractions,
    previous.totalInteractions
  );

  const curEng = normalizePercent(current.engagementRate ?? 0);
  const prevEng = normalizePercent(previous.engagementRate ?? 0);

  const engagement = compareEngagement(curEng, prevEng);

  return {
    followers,
    reach,
    interactions,
    engagement,
  };
}
