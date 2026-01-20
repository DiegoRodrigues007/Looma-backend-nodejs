type IgInsightRow = {
  name?: string;
  period?: string;
  values?: Array<{ value?: any; end_time?: string }>;
  value?: any;
  total_value?: any;
};


export function toFiniteNumber(v: any): number {
  const unwrap = (x: any): any => {
    if (x == null) return 0;

    if (typeof x === "number") return x;
    if (typeof x === "string") {
      const norm = x.trim().replace(",", ".");
      return norm;
    }

    if (typeof x === "object") {
      if ("total_value" in x) return unwrap((x as any).total_value);

      if ("value" in x) return unwrap((x as any).value);

      const arr = (x as any).values;
      if (Array.isArray(arr) && arr.length > 0) {
        const first = arr[0];
        return unwrap(first?.value ?? first);
      }

      return 0;
    }

    return 0;
  };

  const raw = unwrap(v);
  const n = typeof raw === "number" ? raw : Number(raw);

  return Number.isFinite(n) ? n : 0;
}

export function mapInsightByDayRobust(
  insightsData: any[],
  metricName: string,
  days: string[],
  fallbackValue = 0
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) out[d] = toFiniteNumber(fallbackValue);

  if (!Array.isArray(insightsData) || insightsData.length === 0) return out;

  const item: IgInsightRow | undefined = insightsData.find(
    (x: any) => String(x?.name ?? "") === metricName
  );
  if (!item) return out;

  const values = (item as any)?.values;

  if (Array.isArray(values) && values.length > 0) {
    for (const v of values) {
      const endTime: string | undefined = v?.end_time;
      if (!endTime) continue;

      const dayKey = String(endTime).slice(0, 10);
      if (dayKey in out) out[dayKey] = toFiniteNumber(v?.value);
    }
    return out;
  }

  const total = toFiniteNumber((item as any)?.total_value ?? (item as any)?.value);

  if (days.length === 1) {
    out[days[0]] = Number.isFinite(total) ? total : toFiniteNumber(fallbackValue);
  }

  return out;
}
