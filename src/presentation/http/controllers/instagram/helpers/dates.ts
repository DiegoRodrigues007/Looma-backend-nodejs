import { listDays, ymd } from "../../../../../shared/date/instagramDateUtils";

export function dateOnlyUtcFromYmd(ymdStr: string): Date {
  return new Date(`${ymdStr.slice(0, 10)}T00:00:00.000Z`);
}

export function addDaysYmd(ymdStr: string, deltaDays: number): string {
  const d = dateOnlyUtcFromYmd(ymdStr);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return ymd(d);
}

export function clampRangeDays(from: string, to: string, maxDays = 92) {
  const days = listDays(from, to);
  if (days.length <= maxDays) return { days, from, to };

  const tail = days.slice(days.length - maxDays);
  return {
    days: tail,
    from: tail[0],
    to: tail[tail.length - 1],
  };
}
