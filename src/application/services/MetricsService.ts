import { compareKpi } from "./KpiComparator";
import { compareEngagement } from "./EngagementComparator";
import { KpiComparativeDTO } from "../dto/metrics/KpiComparativeDTO";


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

export class MetricsService {

  private static normalizeEngagementPercent(value: number): number {
    const v = Number(value ?? 0);

    if (!Number.isFinite(v)) return 0;
    if (v > 0 && v <= 1) return v * 100;

    return v;
  }

  static buildOverview(current: MetricsSnapshot, previous: MetricsSnapshot): MetricsOverview {
    const followersBase = compareKpi("Seguidores", current.followers, previous.followers);
    const followersDelta = Number(followersBase.delta ?? 0);

    const followers: KpiComparativeDTO = {
      ...followersBase,
      gained: followersDelta > 0 ? followersDelta : 0,
      lost: followersDelta < 0 ? Math.abs(followersDelta) : 0,
    };

    const reach = compareKpi("Alcance", current.reach, previous.reach);

    const interactions = compareKpi("Interações", current.totalInteractions, previous.totalInteractions);

    const curEng = this.normalizeEngagementPercent(current.engagementRate ?? 0);
    const prevEng = this.normalizeEngagementPercent(previous.engagementRate ?? 0);

    const engagement = compareEngagement(curEng, prevEng);

    return {
      followers,
      reach,
      interactions,
      engagement,
    };
  }
}
