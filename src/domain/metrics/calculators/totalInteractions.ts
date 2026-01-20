
function safeNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Total de interações = likes + comments
 */
export function calculateTotalInteractions(params: {
  likeCount: any;
  commentsCount: any;
}): number {
  return safeNum(params.likeCount) + safeNum(params.commentsCount);
}
