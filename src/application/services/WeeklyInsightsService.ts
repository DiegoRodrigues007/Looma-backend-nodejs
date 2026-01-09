import {
  WeeklyInsightsResponseDTO,
  WeeklyInsightDTO,
} from "../dto/metrics/WeeklyInsightsDTO";
import { IMetricsSnapshotRepository } from "../../domain/repositories/IMetricsSnapshotRepository";
import { MetricsPlatform } from "../../domain/entities/MetricsSnapshot";

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseYmd(ymdStr: string): Date {
  return new Date(`${ymdStr}T00:00:00.000Z`);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function safeAvg(values: number[]) {
  const nums = values.filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function pctChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous === 0) return current > 0 ? 1 : 0;
  return (current - previous) / previous;
}

// ✅ TopContent mínimo para regra viral (não acopla no tipo do front)
export type TopContentForInsights = {
  totalInteractions: number;
  reach?: number;
  captionLength?: number; // opcional (se quiser regra de "post longo" depois)
  mediaType?: string;
};

export class WeeklyInsightsService {
  constructor(private readonly snapshotRepo: IMetricsSnapshotRepository) {}

  /**
   * Gera insights baseados em snapshots armazenados (sem IA pesada).
   * ✅ Agora suporta também TopContent (opcional) para detectar padrão viral.
   */
  async generateForUser(
    userId: string,
    platform: MetricsPlatform = "instagram",
    days = 7,
    topContent?: TopContentForInsights[] // ✅ NOVO (opcional)
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

    // ✅ Regra 1: Queda de engajamento
    const erDelta = pctChange(curER, prevER);
    if (erDelta <= -0.2) {
      insights.push({
        level: "warning",
        icon: "⚠️",
        title: "Queda de engajamento",
        detail: `Últimos ${days} dias ${(erDelta * 100).toFixed(
          0
        )}% vs período anterior`,
      });
    }

    // ✅ Regra 2: Queda de alcance
    const reachDelta = pctChange(curReach, prevReach);
    if (reachDelta <= -0.25) {
      insights.push({
        level: "warning",
        icon: "📉",
        title: "Alcance em queda",
        detail: `Últimos ${days} dias ${(reachDelta * 100).toFixed(
          0
        )}% vs período anterior`,
      });
    }

    // ✅ Regra 3: Alta de interações
    const interactionsDelta = pctChange(curInteractions, prevInteractions);
    if (interactionsDelta >= 0.35) {
      insights.push({
        level: "hot",
        icon: "🔥",
        title: "Aumento de interações",
        detail: `Últimos ${days} dias +${(interactionsDelta * 100).toFixed(
          0
        )}% vs período anterior`,
      });
    }

    // ✅ Regra 4 (NOVO): Padrão viral detectado via TopContent
    // Critério simples e forte:
    // - precisa ter dados
    // - top1 >= 2x a média do topContent
    // - e um mínimo de interações pra não disparar com números pequenos
    if (platform === "instagram" && Array.isArray(topContent) && topContent.length >= 3) {
      const interactions = topContent
        .map((x) => Number(x.totalInteractions ?? 0))
        .filter((n) => Number.isFinite(n) && n >= 0);

      if (interactions.length >= 3) {
        const avg = safeAvg(interactions);
        const top = Math.max(...interactions);

        const minToConsider = Math.max(30, avg * 0.8); // evita "viral" com 2 likes
        const ratio = avg > 0 ? top / avg : 0;

        if (top >= minToConsider && ratio >= 2) {
          insights.push({
            level: "hot",
            icon: "🔥",
            title: "Conteúdo com padrão viral detectado",
            detail: `Um conteúdo teve ~${ratio.toFixed(1)}x mais interações que a média do período`,
          });
        }
      }
    }

    // ✅ fallback (sempre retorna algo)
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
