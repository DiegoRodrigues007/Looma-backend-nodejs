import axios from "axios";

type InstagramMetricsResult = {
  followers: number;
  reach: number;
  totalInteractions: number;
  engagementRate: number; // em %
};

export class InstagramMetricsService {
  // ✅ trava a versão pra não depender de auto-upgrade
  private static baseUrl = "https://graph.facebook.com/v24.0";

  private static toNumber(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private static pickMetricValue(data: any, metricName: string): number {
    const row = data?.data?.find((m: any) => m?.name === metricName);
    // alguns retornos podem vir como value direto ou dentro de values[0].value
    const v =
      row?.values?.[0]?.value ??
      row?.total_value?.value ??
      row?.value ??
      0;

    return this.toNumber(v);
  }

  /**
   * Busca métricas "do dia" (period=day).
   * Observação: dependendo da conta/permissões, reach/total_interactions podem vir 0.
   */
  static async fetchDailyMetrics(
    instagramAccountId: string,
    accessToken: string
  ): Promise<InstagramMetricsResult> {
    // -------------------------
    // 1) Followers (node fields)
    // -------------------------
    const followersRes = await axios.get(
      `${this.baseUrl}/${instagramAccountId}`,
      {
        params: {
          fields: "followers_count",
          access_token: accessToken,
        },
      }
    );

    const followers = this.toNumber(followersRes.data?.followers_count);

    // --------------------------------
    // 2) Reach (insights - daily)
    // --------------------------------
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
    } catch (err: any) {
      // se a API negar esse insight, não derruba tudo — apenas fica 0
      // (mas o ideal é você logar isso no backend)
      reach = 0;
    }

    // -------------------------------------------
    // 3) total_interactions (insights - daily)
    // ✅ em alguns apps precisa metric_type=total_value
    // -------------------------------------------
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
    } catch (err: any) {
      totalInteractions = 0;
    }

    // --------------------------------
    // 4) Engagement rate (%)
    // --------------------------------
    const engagementRate =
      reach > 0 ? (totalInteractions / reach) * 100 : 0;

    return {
      followers,
      reach,
      totalInteractions,
      engagementRate,
    };
  }
}
