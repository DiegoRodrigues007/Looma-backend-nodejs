export type TrendDirection = "up" | "down" | "equal";

export interface KpiComparativeDTO {
  label: string;

  current: number;
  previous: number;

  delta: number;          // diferença absoluta
  deltaPercent?: number;  // % (quando aplicável)
  deltaLabel: string;     // texto pronto pro card

  trend: TrendDirection;
}
