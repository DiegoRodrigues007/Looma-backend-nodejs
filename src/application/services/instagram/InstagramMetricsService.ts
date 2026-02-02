import { calculateEngagementRate } from "../../../domain/metrics/calculators/engagementRate";
import type {
  IInstagramMetricsClient,
  InstagramMetricsResult,
} from "../../../application/interfaces/instagram/IInstagramMetricsClient";

export class InstagramMetricsService {
  constructor(private readonly metricsClient: IInstagramMetricsClient) {}

  async fetchDailyMetrics(
    instagramAccountId: string,
    accessToken: string
  ): Promise<InstagramMetricsResult> {
    const baseInput = { instagramAccountId, accessToken, timeoutMs: 15000 };

    const followers = await this.safeCall(() =>
      this.metricsClient.getFollowersCount(baseInput)
    );

    const reach = await this.safeCall(() =>
      this.metricsClient.getDailyReach(baseInput)
    );

    const totalInteractions = await this.safeCall(() =>
      this.metricsClient.getDailyTotalInteractions(baseInput)
    );

    const engagementRate = calculateEngagementRate({
      reach,
      totalInteractions,
    });

    return {
      followers,
      reach,
      totalInteractions,
      engagementRate,
    };
  }

  private async safeCall(fn: () => Promise<number>): Promise<number> {
    try {
      const v = await fn();
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  }
}
