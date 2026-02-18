// src/application/services/insights/types.ts

/**
 * ============================================
 * Insight Types
 * ============================================
 * Categorias de inteligência que o Looma entende.
 * Conforme novos motores forem criados,
 * basta adicionar novos tipos aqui.
 */
export type InsightType =
  | "baseline_above_normal"
  | "baseline_below_normal"
  | "baseline_spike"
  | "baseline_drop"
  | "posting_time_driver"
  | "content_type_driver"
  | "frequency_driver"
  | "prediction";

/**
 * ============================================
 * Ações recomendadas
 * ============================================
 */
export type InsightAction = {
  label: string;
  reason?: string;
};

/**
 * ============================================
 * Insight principal (o produto final)
 * ============================================
 */
export type Insight = {
  /**
   * ID único do insight
   */
  id: string;

  /**
   * Tipo do insight (baseline, horário, reels, etc.)
   */
  type: InsightType;

  /**
   * Título curto para UI
   */
  title: string;

  /**
   * Explicação em linguagem humana
   */
  message: string;

  /**
   * Confiança do algoritmo (0..1)
   */
  confidence: number;

  /**
   * Dados que justificam o insight.
   * Importante para debug, auditoria e IA futura.
   */
  evidence: Record<string, any>;

  /**
   * Sugestões de ação para o usuário
   */
  actions?: InsightAction[];
};

/**
 * ============================================
 * Input do Builder
 * ============================================
 */
export type BuildInstagramInsightsInput = {
  userId: string;
  instagramAccountId: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD

  baselineDays?: number;
  maxInsights?: number;
};

/**
 * ============================================
 * Output do Builder
 * ============================================
 */
export type BuildInstagramInsightsResult = {
  range: {
    from: string;
    to: string;
    days: number;
  };

  insights: Insight[];

  debug?: Record<string, any>;
};
