/**
 * Calcula engagement rate em percentual.
 * Fórmula: (interações / alcance) * 100
 */
export function calculateEngagementRate(params: {
  reach: number;
  totalInteractions: number;
}): number {
  const reach = Number(params.reach ?? 0);
  const interactions = Number(params.totalInteractions ?? 0);

  if (!Number.isFinite(reach) || reach <= 0) return 0;
  if (!Number.isFinite(interactions) || interactions <= 0) return 0;

  return (interactions / reach) * 100;
}
