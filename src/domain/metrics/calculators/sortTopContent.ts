export type TopContentSortable = {
  totalInteractions: number;
};

/**
 * Ordena por totalInteractions desc e retorna top N.
 * Não muta o array original.
 */
export function sortTopContent<T extends TopContentSortable>(
  items: T[],
  limit: number
): T[] {
  const n = Math.max(0, Number(limit ?? 0) || 0);
  if (n === 0) return [];

  return [...items]
    .sort((a, b) => (b.totalInteractions ?? 0) - (a.totalInteractions ?? 0))
    .slice(0, n);
}
