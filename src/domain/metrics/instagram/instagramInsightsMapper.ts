type IgInsightRow = {
  name?: string;
  period?: string;
  values?: Array<{ value?: any; end_time?: string }>;
  value?: any;
  total_value?: any;
};

/**
 * Converte entradas "insanas" em número seguro.
 * Regras (pra bater com seus testes):
 * - sempre retorna number finito
 * - nunca retorna negativo (clamp em 0)
 * - NaN/Infinity/null/undefined/obj estranho => 0
 * - string "10,5" => 10.5
 */
export function toFiniteNumber(v: any): number {
  const unwrap = (x: any): any => {
    if (x == null) return 0;

    if (typeof x === "number") return x;

    if (typeof x === "string") {
      const norm = x.trim().replace(",", ".");
      // retorna string normalizada (vai ser Number(...) depois)
      return norm.length ? norm : 0;
    }

    if (typeof x === "object") {
      // { total_value: ... }
      if ("total_value" in x) return unwrap((x as any).total_value);

      // { value: ... }
      if ("value" in x) return unwrap((x as any).value);

      // { values: [...] } (meta graph)
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

  // ✅ garante finito
  if (!Number.isFinite(n)) return 0;

  // ✅ garante não-negativo (seu teste exige isso)
  if (n < 0) return 0;

  return n;
}

export function mapInsightByDayRobust(
  insightsData: any[],
  metricName: string,
  days: string[],
  fallbackValue = 0
): Record<string, number> {
  const out: Record<string, number> = {};

  // default seguro
  const fallback = toFiniteNumber(fallbackValue);
  for (const d of days) out[d] = fallback;

  if (!Array.isArray(insightsData) || insightsData.length === 0) return out;

  const item: IgInsightRow | undefined = insightsData.find(
    (x: any) => String(x?.name ?? "") === metricName
  );
  if (!item) return out;

  const values = item?.values;

  // Caso "timeseries" (values com end_time)
  if (Array.isArray(values) && values.length > 0) {
    for (const v of values) {
      const endTime: string | undefined = v?.end_time;
      if (!endTime) continue;

      const dayKey = String(endTime).slice(0, 10);
      if (dayKey in out) out[dayKey] = toFiniteNumber(v?.value);
    }
    return out;
  }

  // Caso "total" (sem values)
  const total = toFiniteNumber(item?.total_value ?? item?.value);

  // Se o caller quer só 1 dia, joga o total nesse dia
  if (days.length === 1) {
    out[days[0]] = total;
  }

  return out;
}