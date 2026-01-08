export type TrendDirection = "up" | "down" | "equal";

export interface KpiComparativeDTO {
  label: string;
  current: number;
  previous: number;
  delta: number;          
  deltaPercent?: number; 
  deltaLabel: string;     
  gained?: number;
  lost?: number;
  trend: TrendDirection;
}
