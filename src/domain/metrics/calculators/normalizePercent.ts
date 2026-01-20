/**
 * Normaliza percentuais quando o backend pode retornar:
 * - 0..1 (ex: 0.23) => 23
 * - 0..100 (ex: 23) => 23
 */

export function normalizePercent(value: number): number {
  const v = Number(value ?? 0);

  if (!Number.isFinite(v)) return 0;
  if (v > 0 && v <= 1) return v * 100;

  return v;
}
