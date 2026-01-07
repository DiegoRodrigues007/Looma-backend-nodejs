import { KpiComparativeDTO, TrendDirection } from "../dto/metrics/KpiComparativeDTO";

export function compareKpi(
  label: string,
  current: number,
  previous: number
): KpiComparativeDTO {
  const delta = current - previous;

  let deltaPercent: number | undefined = undefined;
  if (previous !== 0) {
    deltaPercent = (delta / previous) * 100;
  }

  let trend: TrendDirection = "equal";
  if (delta > 0) trend = "up";
  else if (delta < 0) trend = "down";

  const arrow =
    trend === "up" ? "▲" :
    trend === "down" ? "▼" :
    "■";

  const percentText =
    deltaPercent !== undefined
      ? ` (${Math.abs(deltaPercent).toFixed(1)}%)`
      : "";

  return {
    label,
    current,
    previous,
    delta,
    deltaPercent,
    trend,
    deltaLabel: `${arrow} ${delta >= 0 ? "+" : ""}${delta}${percentText}`,
  };
}
