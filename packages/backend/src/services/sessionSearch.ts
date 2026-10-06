// Reciprocal-rank fusion for hybrid session search. Each input list is a
// ranking (best first); a turn's fused score is the sum of 1 / (k + rank)
// over the lists it appears in. k = 60 is the standard constant: it damps the
// gap between rank 1 and rank 2 so no single ranking dominates.

export const RRF_K = 60;

export interface RankedList<S extends string> {
  source: S;
  ids: string[];
}

export interface FusedHit<S extends string> {
  id: string;
  score: number;
  sources: S[];
}

export function rrfMerge<S extends string>(lists: RankedList<S>[], k = RRF_K): FusedHit<S>[] {
  const fused = new Map<string, FusedHit<S>>();
  for (const { source, ids } of lists) {
    ids.forEach((id, i) => {
      const hit = fused.get(id) ?? { id, score: 0, sources: [] };
      hit.score += 1 / (k + i + 1);
      if (!hit.sources.includes(source)) hit.sources.push(source);
      fused.set(id, hit);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}
