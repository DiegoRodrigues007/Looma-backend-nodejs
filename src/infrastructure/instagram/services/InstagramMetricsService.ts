import axios from "axios";
import { calculateEngagementRate } from "../../../domain/metrics/calculators/engagementRate";

type InstagramMetricsResult = {
  followers: number;
  reach: number;
  totalInteractions: number;
  engagementRate: number; 
};

export class InstagramMetricsService {
  private static baseUrl = "https://graph.facebook.com/v24.0";

  private static toNumber(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private static pickMetricValue(data: any, metricName: string): number {
    const row = data?.data?.find((m: any) => m?.name === metricName);

    const v =
      row?.values?.[0]?.value ??
      row?.total_value?.value ??
      row?.value ??
      0;

    return this.toNumber(v);
  }

  static async fetchDailyMetrics(
    instagramAccountId: string,
    accessToken: string
  ): Promise<InstagramMetricsResult> {

    const followersRes = await axios.get(
      `${this.baseUrl}/${instagramAccountId}`,
      {
        params: {
          fields: "followers_count",
          access_token: accessToken,
        },
      }
    );

    const followers = this.toNumber(
      followersRes.data?.followers_count
    );

    let reach = 0;
    try {
      const reachRes = await axios.get(
        `${this.baseUrl}/${instagramAccountId}/insights`,
        {
          params: {
            metric: "reach",
            period: "day",
            access_token: accessToken,
          },
        }
      );

      reach = this.pickMetricValue(reachRes.data, "reach");
    } catch {
      reach = 0;
    }

    let totalInteractions = 0;
    try {
      const interactionsRes = await axios.get(
        `${this.baseUrl}/${instagramAccountId}/insights`,
        {
          params: {
            metric: "total_interactions",
            period: "day",
            metric_type: "total_value",
            access_token: accessToken,
          },
        }
      );

      totalInteractions = this.pickMetricValue(
        interactionsRes.data,
        "total_interactions"
      );
    } catch {
      totalInteractions = 0;
    }

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
}
