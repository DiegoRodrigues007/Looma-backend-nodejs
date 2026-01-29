// src/domain/metrics/calculators/compareKpi.ts

import {
  KpiComparativeDTO,
  TrendDirection,
} from "../../../application/dto/metrics/KpiComparativeDTO";

/**
 * Converte qualquer coisa em número finito e NÃO negativo
 * ✅ string "12,5"
 * ✅ NaN / Infinity / null / undefined
 * ✅ negativos -> 0
 */
function toFiniteNonNegativeNumber(v: any): number {
  const raw = typeof v === "string" ? v.trim().replace(",", ".") : v;
  const n = typeof raw === "number" ? raw : Number(raw);

  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;

  return n;
}

export function compareKpi(
  label: string,
  current: any,
  previous: any
): KpiComparativeDTO {
  const cur = toFiniteNonNegativeNumber(current);
  const prev = toFiniteNonNegativeNumber(previous);

  const delta = cur - prev;

  const gained = delta > 0 ? delta : 0;
  const lost = delta < 0 ? Math.abs(delta) : 0;

  // ✅ trend neutro não é mais "equal"
  let trend: TrendDirection = "neutral" as TrendDirection;
  if (delta > 0) trend = "up";
  else if (delta < 0) trend = "down";

  // ✅ deltaPercent sempre finito e >= 0
  let deltaPercent = 0;
  if (prev === 0) {
    deltaPercent = cur === 0 ? 0 : 100;
  } else {
    deltaPercent = Math.abs((delta / prev) * 100);
    if (!Number.isFinite(deltaPercent) || deltaPercent < 0) deltaPercent = 0;
  }

  const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "■";

  const percentText = ` (${deltaPercent.toFixed(1)}%)`;

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