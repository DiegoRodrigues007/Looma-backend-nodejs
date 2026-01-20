export type DayMap = Record<string, number>;

export function addByDay(map: DayMap, day: string, value: number): void {
  const v = Number(value ?? 0);
  map[day] = (map[day] ?? 0) + (Number.isFinite(v) ? v : 0);
}

export function sumInteractions(params: {
  likes?: number;
  comments?: number;
  shares?: number;
  saved?: number;
}): number {
  const likes = Number(params.likes ?? 0);
  const comments = Number(params.comments ?? 0);
  const shares = Number(params.shares ?? 0);
  const saved = Number(params.saved ?? 0);

  return (
    (Number.isFinite(likes) ? likes : 0) +
    (Number.isFinite(comments) ? comments : 0) +
    (Number.isFinite(shares) ? shares : 0) +
    (Number.isFinite(saved) ? saved : 0)
  );
}

export function ensureDay(map: DayMap, day: string): void {
  if (map[day] == null) map[day] = 0;
}
