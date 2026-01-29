import { compareKpi } from "./compareKpi";
import { compareEngagement } from "./compareEngagement";
import { normalizePercent } from "./normalizePercent";
import { KpiComparativeDTO } from "../../../application/dto/metrics/KpiComparativeDTO";

export interface MetricsSnapshot {
  followers: number;
  reach: number;
  totalInteractions: number;
  engagementRate: number;
}

export interface MetricsOverview {
  followers: KpiComparativeDTO;
  reach: KpiComparativeDTO;
  interactions: KpiComparativeDTO;
  engagement: KpiComparativeDTO;
}

function toFiniteNonNegativeNumber(v: any): number {
  const raw = typeof v === "string" ? v.trim().replace(",", ".") : v;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}

/**
 * Regra de %:
 * - se previous = 0 e current > 0 => 100
 * - se previous = 0 e current = 0 => 0
 * - caso normal => abs(delta)/abs(previous)*100
 * ✅ sempre finito e >= 0
 */
function safeDeltaPercent(current: any, previous: any): number {
  const curr = toFiniteNonNegativeNumber(current);
  const prev = toFiniteNonNegativeNumber(previous);

  if (prev === 0) return curr > 0 ? 100 : 0;

  const pct = (Math.abs(curr - prev) / prev) * 100;
  return Number.isFinite(pct) && pct >= 0 ? pct : 0;
}

export function buildKpis(
  current: MetricsSnapshot,
  previous: MetricsSnapshot
): MetricsOverview {
  // ✅ normaliza entrada (evita NaN/Infinity/negativo)
  const currFollowers = toFiniteNonNegativeNumber((current as any)?.followers);
  const prevFollowers = toFiniteNonNegativeNumber((previous as any)?.followers);

  const currReach = toFiniteNonNegativeNumber((current as any)?.reach);
  const prevReach = toFiniteNonNegativeNumber((previous as any)?.reach);

  const currInteractions = toFiniteNonNegativeNumber((current as any)?.totalInteractions);
  const prevInteractions = toFiniteNonNegativeNumber((previous as any)?.totalInteractions);

  // Followers base
  const followersBase = compareKpi("Seguidores", currFollowers, prevFollowers);

  const deltaFollowers = (() => {
    const n = Number(followersBase.delta ?? 0);
    return Number.isFinite(n) ? n : 0;
  })();

  const gained = deltaFollowers > 0 ? deltaFollowers : 0;
  const lost = deltaFollowers < 0 ? Math.abs(deltaFollowers) : 0;

  const followers: KpiComparativeDTO = {
    ...followersBase,
    current: currFollowers,
    previous: prevFollowers,
    delta: deltaFollowers,
    // ✅ garantias pros testes/invariantes
    gained,
    lost,
    deltaPercent: safeDeltaPercent(currFollowers, prevFollowers),
  };

  // Reach
  const reachBase = compareKpi("Alcance", currReach, prevReach);
  const reach: KpiComparativeDTO = {
    ...reachBase,
    current: currReach,
    previous: prevReach,
    delta: Number.isFinite(Number(reachBase.delta)) ? Number(reachBase.delta) : currReach - prevReach,
    deltaPercent: safeDeltaPercent(currReach, prevReach),
  };

  // Interactions
  const interactionsBase = compareKpi("Interações", currInteractions, prevInteractions);
  const interactions: KpiComparativeDTO = {
    ...interactionsBase,
    current: currInteractions,
    previous: prevInteractions,
    delta: Number.isFinite(Number(interactionsBase.delta))
      ? Number(interactionsBase.delta)
      : currInteractions - prevInteractions,
    deltaPercent: safeDeltaPercent(currInteractions, prevInteractions),
  };

  // Engagement (%)
  const curEng = normalizePercent((current as any)?.engagementRate ?? 0);
  const prevEng = normalizePercent((previous as any)?.engagementRate ?? 0);
  const engagement = compareEngagement(curEng, prevEng);

  return {
    followers,
    reach,
    interactions,
    engagement,
  };
}