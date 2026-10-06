import { describe, expect, test } from "bun:test";
import { RRF_K, rrfMerge } from "../sessionSearch";

describe("rrfMerge", () => {
  test("scores by reciprocal rank and records every source", () => {
    const fused = rrfMerge([
      { source: "keyword", ids: ["a", "b"] },
      { source: "semantic", ids: ["b", "c"] },
    ]);
    expect(fused.map((h) => h.id)).toEqual(["b", "a", "c"]);
    expect(fused[0]).toEqual({
      id: "b",
      score: 1 / (RRF_K + 2) + 1 / (RRF_K + 1),
      sources: ["keyword", "semantic"],
    });
    expect(fused[1].sources).toEqual(["keyword"]);
  });

  test("a turn in both semantic lists is boosted but tagged once", () => {
    const fused = rrfMerge([
      { source: "semantic", ids: ["x"] },
      { source: "semantic", ids: ["x"] },
    ]);
    expect(fused).toHaveLength(1);
    expect(fused[0].sources).toEqual(["semantic"]);
    expect(fused[0].score).toBeCloseTo(2 / (RRF_K + 1));
  });

  test("empty input gives no hits", () => {
    expect(rrfMerge([{ source: "keyword", ids: [] }])).toEqual([]);
  });
});
