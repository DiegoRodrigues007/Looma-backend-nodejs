export function safeAvg(values: number[]): number {
  const nums = (values ?? []).filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function pctChange(current: number, previous: number): number {
  const cur = Number(current);
  const prev = Number(previous);

  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return 0;
  if (prev === 0) return cur > 0 ? 1 : 0;
  return (cur - prev) / prev;
}

export function detectViralPattern(params: {
  interactions: number[];
  minBase?: number; 
  minRatio?: number; 
}): { detected: boolean; ratio: number; avg: number; top: number; minToConsider: number } {
  const minBase = Number(params.minBase ?? 30);
  const minRatio = Number(params.minRatio ?? 2);

  const interactions = (params.interactions ?? [])
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 0);

  if (interactions.length < 3) {
    return { detected: false, ratio: 0, avg: 0, top: 0, minToConsider: 0 };
  }

  const avg = safeAvg(interactions);
  const top = Math.max(...interactions);

  const minToConsider = Math.max(minBase, avg * 0.8);
  const ratio = avg > 0 ? top / avg : 0;

  const detected = top >= minToConsider && ratio >= minRatio;

  return { detected, ratio, avg, top, minToConsider };
}
