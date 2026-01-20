export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseYmd(ymdStr: string): Date {
  const s = String(ymdStr ?? "").slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`parseYmd: formato inválido: "${ymdStr}"`);
  }

  const d = new Date(`${s}T00:00:00.000Z`);

  if (Number.isNaN(d.getTime()) || ymd(d) !== s) {
    throw new Error(`parseYmd: data inválida: "${ymdStr}"`);
  }

  return d;
}

export function addDaysYmd(dayYmd: string, deltaDays: number): string {
  const d = parseYmd(dayYmd);
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
  return ymd(d);
}

export function listDays(from: string, to: string): string[] {
  const start = parseYmd(from);
  const end = parseYmd(to);

  if (ymd(start) > ymd(end)) return [];

  const days: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(ymd(d));
  }
  return days;
}
