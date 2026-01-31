import { InstagramDomainError } from "../errors/InstagramDomainError";

export type Ymd = string & { readonly __brand: "Ymd" };

export function Ymd(value: unknown): Ymd {
  const s = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw InstagramDomainError.invalidInput("Invalid YMD date format.", { value: s });
  }
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) {
    throw InstagramDomainError.invalidInput("Invalid YMD date (unparsable).", { value: s });
  }
  const back = d.toISOString().slice(0, 10);
  if (back !== s) {
    throw InstagramDomainError.invalidInput("Invalid YMD date (overflow).", { value: s });
  }
  return s as Ymd;
}

export type DateRangeYmd = {
  from: Ymd;
  to: Ymd; 
};

export function DateRangeYmd(from: unknown, to: unknown): DateRangeYmd {
  const f = Ymd(from);
  const t = Ymd(to);

  if (f > t) {
    throw InstagramDomainError.invalidDateRange({ from: f, to: t });
  }

  return { from: f, to: t };
}

export function ymdToDateUTC(ymd: Ymd): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function addDaysYmd(ymd: Ymd, days: number): Ymd {
  const d = ymdToDateUTC(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return Ymd(d.toISOString().slice(0, 10));
}

export function eachDayInclusive(range: DateRangeYmd): Ymd[] {
  const out: Ymd[] = [];
  let cur = range.from;
  while (cur <= range.to) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}
