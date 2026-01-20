export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseYmd(ymdStr: string): Date {
  return new Date(`${ymdStr}T00:00:00.000Z`);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
