import {
  KpiComparativeDTO,
  TrendDirection,
} from "../../../application/dto/metrics/KpiComparativeDTO";

/**
 * Converte qualquer coisa em número finito
 * ✅ string "12,5"
 * ✅ NaN / Infinity / null / undefined
 * ✅ negativos -> 0 (para manter invariantes do seu domínio/testes)
 * ✅ nunca retorna NaN/Infinity
 */
function toFiniteNonNegativeNumber(v: any): number {
  const raw = typeof v === "string" ? v.trim().replace(",", ".") : v;
  const n = typeof raw === "number" ? raw : Number(raw);

  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;

  return n;
}

export function compareEngagement(
  current: any,
  previous: any
): KpiComparativeDTO {
  const curr = toFiniteNonNegativeNumber(current);
  const prev = toFiniteNonNegativeNumber(previous);

  const delta = curr - prev;

  // ✅ não usar mais "equal"
  // se seu TrendDirection agora aceita "neutral", use isso
  let trend: TrendDirection = "neutral" as TrendDirection;
  if (delta > 0) trend = "up";
  else if (delta < 0) trend = "down";

  const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "■";

  return {
    label: "Engajamento",
    current: curr,
    previous: prev,
    delta,
    trend,
    deltaLabel: `${arrow} ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}pp`,
  };
}