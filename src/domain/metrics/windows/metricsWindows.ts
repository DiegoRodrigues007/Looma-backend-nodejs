// src/domain/instagram/metricsWindows.ts

export type InstagramTimeseriesPoint = {
  date: string; // YYYY-MM-DD
  followers: number;
  reach: number;
  profileViews: number;
  totalInteractions: number;
  engagementRate: number; // %
};

export type InstagramWindowSummary = {
  reach: number;
  profileViews: number;
  totalInteractions: number;
  engagementRate: number; // %
};

/**
 * Converte qualquer coisa em number seguro:
 * - NaN/Infinity/undefined/null => 0
 * - negativos => 0 (pra bater com seus testes de "não-negativo")
 * - strings numéricas ok
 */
function toFiniteNonNegativeNumber(v: any): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return n;
}

function safeDateKey(v: any): string {
  // mantém determinístico mesmo com lixo
  return typeof v === "string" ? v : String(v ?? "");
}

/**
 * Ordena por date asc (YYYY-MM-DD) de forma determinística.
 * Para datas inválidas, coloca no fim mantendo estabilidade.
 */
function sortByDateAsc(
  a: InstagramTimeseriesPoint,
  b: InstagramTimeseriesPoint
): number {
  const da = safeDateKey(a.date);
  const db = safeDateKey(b.date);

  // comparação lexicográfica funciona pra YYYY-MM-DD
  const aValid = /^\d{4}-\d{2}-\d{2}$/.test(da);
  const bValid = /^\d{4}-\d{2}-\d{2}$/.test(db);

  if (aValid && bValid) return da.localeCompare(db);
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  return da.localeCompare(db);
}

export function windowAgg(
  timeseries: InstagramTimeseriesPoint[],
  windowDays: number
): InstagramWindowSummary {
  const arr = Array.isArray(timeseries) ? timeseries : [];

  // ✅ garante que "últimos N" sejam os últimos por data, não por ordem recebida
  const sorted = [...arr].sort(sortByDateAsc);

  const wd = toFiniteNonNegativeNumber(windowDays);
  const effectiveWindow = wd > 0 ? Math.floor(wd) : 0;

  const slice =
    effectiveWindow === 0
      ? []
      : sorted.slice(Math.max(0, sorted.length - effectiveWindow));

  const reach = slice.reduce((acc, x) => acc + toFiniteNonNegativeNumber(x.reach), 0);

  const profileViews = slice.reduce(
    (acc, x) => acc + toFiniteNonNegativeNumber(x.profileViews),
    0
  );

  const totalInteractions = slice.reduce(
    (acc, x) => acc + toFiniteNonNegativeNumber(x.totalInteractions),
    0
  );

  // ✅ sempre finito e não-negativo
  const engagementRate = reach > 0 ? (totalInteractions / reach) * 100 : 0;

  return {
    reach: toFiniteNonNegativeNumber(reach),
    profileViews: toFiniteNonNegativeNumber(profileViews),
    totalInteractions: toFiniteNonNegativeNumber(totalInteractions),
    engagementRate: toFiniteNonNegativeNumber(engagementRate),
  };
}

export function buildWindowsSummary(timeseries: InstagramTimeseriesPoint[]) {
  return {
    last7d: windowAgg(timeseries, 7),
    last30d: windowAgg(timeseries, 30),
  };
}