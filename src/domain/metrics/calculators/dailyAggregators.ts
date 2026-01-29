
export type DayMap = Record<string, number>;

function toFiniteNonNegativeNumber(v: any): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}

export function addByDay(map: DayMap, day: string, value: any): void {
  const key = String(day ?? "");
  if (!key) return;

  const current = toFiniteNonNegativeNumber(map[key]);
  const add = toFiniteNonNegativeNumber(value);

  map[key] = current + add;
}

export function sumInteractions(
  params?: {
    likes?: any;
    comments?: any;
    shares?: any;
    saved?: any;
  } | null
): number {
  const p = params ?? {};

  const likes = toFiniteNonNegativeNumber((p as any).likes);
  const comments = toFiniteNonNegativeNumber((p as any).comments);
  const shares = toFiniteNonNegativeNumber((p as any).shares);
  const saved = toFiniteNonNegativeNumber((p as any).saved);

  return likes + comments + shares + saved;
}

export function ensureDay(map: DayMap, day: string): void {
  const key = String(day ?? "");
  if (!key) return;

  if (map[key] == null) {
    map[key] = 0;
  }
}