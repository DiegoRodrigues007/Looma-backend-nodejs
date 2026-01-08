import { KpiComparativeDTO, TrendDirection } from "../dto/metrics/KpiComparativeDTO";

export function compareKpi(
  label: string,
  current: number,
  previous: number
): KpiComparativeDTO {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;

  const delta = cur - prev;

  const gained = delta > 0 ? delta : 0;
  const lost = delta < 0 ? Math.abs(delta) : 0;

  let deltaPercent: number | undefined = undefined;
  if (prev === 0) {
    deltaPercent = cur === 0 ? 0 : 100;
  } else {
    deltaPercent = (delta / prev) * 100;
  }

  let trend: TrendDirection = "equal";
  if (delta > 0) trend = "up";
  else if (delta < 0) trend = "down";

  const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "■";

  const percentText =
    deltaPercent !== undefined ? ` (${Math.abs(deltaPercent).toFixed(1)}%)` : "";

  return {
    label,
    current: cur,
    previous: prev,
    delta,
    deltaPercent,
    trend,
    deltaLabel: `${arrow} ${delta >= 0 ? "+" : ""}${delta}${percentText}`,
    gained,
    lost,
  };
}
