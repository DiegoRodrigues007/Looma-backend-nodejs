// src/application/dto/metrics/WeeklyInsightsDTO.ts

export type InsightLevel = "info" | "warning" | "hot";

export type WeeklyInsightDTO = {
  level: InsightLevel;
  icon: string;   // "⚠️" | "🔥" | "📉" etc
  title: string;  // "Queda de engajamento"
  detail?: string; // "Últimos 7 dias -23% vs 7 dias anteriores"
};

export type WeeklyInsightsResponseDTO = {
  period: {
    days: number;
    from: string; // YYYY-MM-DD
    to: string;   // YYYY-MM-DD
    compareFrom?: string; // YYYY-MM-DD
    compareTo?: string;   // YYYY-MM-DD
  };
  insights: WeeklyInsightDTO[];
};
