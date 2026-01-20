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

    if (typeof x === "number" || typeof x === "string") return x;

    if (typeof x === "object") {
      if ("total_value" in x) return unwrap((x as any).total_value);
      if ("value" in x) return unwrap((x as any).value);

      if (Array.isArray((x as any).values) && (x as any).values.length > 0) {
        const first = (x as any).values[0];
        return unwrap(first?.value ?? first);
      }

      return 0;
    }

    return 0;
  };

  const n = Number(unwrap(v));
  return Number.isFinite(n) ? n : 0;
}

export function mapInsightByDayRobust(
  insightsData: any[],
  metricName: string,
  days: string[],
  fallbackValue = 0
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) out[d] = fallbackValue;

  const item = insightsData?.find((x: any) => x?.name === metricName);
  if (!item) return out;

  const values = item?.values;

  if (Array.isArray(values) && values.length > 0) {
    for (const v of values) {
      const endTime: string | undefined = v?.end_time;
      if (!endTime) continue;

      const day = endTime.slice(0, 10);
      if (day in out) out[day] = toFiniteNumber(v?.value);
    }
    return out;
  }

  const total = toFiniteNumber(item?.total_value ?? item?.value ?? fallbackValue);

  if (days.length === 1) {
    out[days[0]] = total;
  }

  return out;
}
