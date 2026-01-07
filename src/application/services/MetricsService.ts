import { compareKpi } from "./KpiComparator";
import { compareEngagement } from "./EngagementComparator";
import { KpiComparativeDTO } from "../dto/metrics/KpiComparativeDTO";

/**
 * Input esperado do MetricsService
 * (normalmente vem de APIs externas ou banco)
 */
export interface MetricsSnapshot {
  followers: number;
  reach: number;
  totalInteractions: number;
  engagementRate: number; // ex: 0.032 = 3.2%
}

/**
 * Output FINAL que o frontend consome
 */
export interface MetricsOverview {
  followers: KpiComparativeDTO;
  reach: KpiComparativeDTO;
  interactions: KpiComparativeDTO;
  engagement: KpiComparativeDTO;
}

export class MetricsService {
  /**
   * Gera visão comparativa completa
   */
  static buildOverview(
    current: MetricsSnapshot,
    previous: MetricsSnapshot
  ): MetricsOverview {
    return {
      followers: compareKpi(
        "Seguidores",
        current.followers,
        previous.followers
      ),

      reach: compareKpi(
        "Alcance",
        current.reach,
        previous.reach
      ),

      interactions: compareKpi(
        "Interações",
        current.totalInteractions,
        previous.totalInteractions
      ),

      engagement: compareEngagement(
        current.engagementRate * 100, // converte para %
        previous.engagementRate * 100
      ),
    };
  }
}
