import { KpiComparativeDTO, TrendDirection } from "../../../application/dto/metrics/KpiComparativeDTO";

export function compareEngagement(
  current: number,
  previous: number
): KpiComparativeDTO {
  const delta = current - previous;

  let trend: TrendDirection = "equal";
  if (delta > 0) trend = "up";
  else if (delta < 0) trend = "down";

  const arrow =
    trend === "up" ? "▲" :
    trend === "down" ? "▼" :
    "■";

  return {
    label: "Engajamento",
    current,
    previous,
    delta,
    trend,
    deltaLabel: `${arrow} ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}pp`,
  };
}
