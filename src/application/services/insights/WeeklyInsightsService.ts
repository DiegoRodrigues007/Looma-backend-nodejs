import {
  WeeklyInsightsResponseDTO,
  WeeklyInsightDTO,
} from "../../dto/metrics/WeeklyInsightsDTO";
import { IMetricsSnapshotRepository } from "../../../domain/repositories/IMetricsSnapshotRepository";
import { MetricsPlatform } from "../../../domain/entities/MetricsSnapshot";

import { ymd, parseYmd, addDays } from "../../../shared/date/ymd";
import {
  safeAvg,
  pctChange,
  detectViralPattern,
} from "../../../domain/insights/calculators/weeklyInsightsMath";

export type TopContentForInsights = {
  totalInteractions: number;
  reach?: number;
  captionLength?: number;
  mediaType?: string;
};

export class WeeklyInsightsService {
  constructor(private readonly snapshotRepo: IMetricsSnapshotRepository) {}

  async generateForUser(
    userId: string,
    platform: MetricsPlatform = "instagram",
    days = 7,
    topContent?: TopContentForInsights[]
  ): Promise<WeeklyInsightsResponseDTO> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const to = today;
    const from = addDays(to, -(days * 2 - 1));

    const rows = await this.snapshotRepo.findRange(userId, platform, from, to);

    const fromStr = ymd(from);
    const toStr = ymd(to);

    const currentFromDate = addDays(parseYmd(fromStr), days);
    const currentFromStr = ymd(currentFromDate);

    const compare = rows.filter((r) => ymd(r.date) < currentFromStr);
    const current = rows.filter((r) => ymd(r.date) >= currentFromStr);

    const curER = safeAvg(current.map((r) => Number(r.engagementRate ?? 0)));
    const prevER = safeAvg(compare.map((r) => Number(r.engagementRate ?? 0)));

    const curInteractions = safeAvg(
      current.map((r) => Number(r.totalInteractions ?? 0))
    );
    const prevInteractions = safeAvg(
      compare.map((r) => Number(r.totalInteractions ?? 0))
    );

    const curReach = safeAvg(current.map((r) => Number(r.reach ?? 0)));
    const prevReach = safeAvg(compare.map((r) => Number(r.reach ?? 0)));

    const insights: WeeklyInsightDTO[] = [];

    const erDelta = pctChange(curER, prevER);
    if (erDelta <= -0.2) {
      insights.push({
        level: "warning",
        icon: "⚠️",
        title: "Queda de engajamento",
        detail: `Últimos ${days} dias ${(erDelta * 100).toFixed(0)}% vs período anterior`,
      });
    }

    const reachDelta = pctChange(curReach, prevReach);
    if (reachDelta <= -0.25) {
      insights.push({
        level: "warning",
        icon: "📉",
        title: "Alcance em queda",
        detail: `Últimos ${days} dias ${(reachDelta * 100).toFixed(0)}% vs período anterior`,
      });
    }

    const interactionsDelta = pctChange(curInteractions, prevInteractions);
    if (interactionsDelta >= 0.35) {
      insights.push({
        level: "hot",
        icon: "🔥",
        title: "Aumento de interações",
        detail: `Últimos ${days} dias +${(interactionsDelta * 100).toFixed(0)}% vs período anterior`,
      });
    }

    if (
      platform === "instagram" &&
      Array.isArray(topContent) &&
      topContent.length >= 3
    ) {
      const interactions = topContent
        .map((x) => Number(x.totalInteractions ?? 0))
        .filter((n) => Number.isFinite(n) && n >= 0);

      const viral = detectViralPattern({ interactions, minBase: 30, minRatio: 2 });

      if (viral.detected) {
        insights.push({
          level: "hot",
          icon: "🔥",
          title: "Conteúdo com padrão viral detectado",
          detail: `Um conteúdo teve ~${viral.ratio.toFixed(1)}x mais interações que a média do período`,
        });
      }
    }

    if (!insights.length) {
      insights.push({
        level: "info",
        icon: "✅",
        title: "Tudo está estável",
        detail: `Nenhuma variação anormal nos últimos ${days} dias`,
      });
    }

    const compareFrom = fromStr;
    const compareTo = ymd(addDays(parseYmd(currentFromStr), -1));

    return {
      period: {
        days,
        from: currentFromStr,
        to: toStr,
        compareFrom,
        compareTo,
      },
      insights,
    };
  }
}
