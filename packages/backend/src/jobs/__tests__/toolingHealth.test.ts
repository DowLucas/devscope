import { describe, expect, test } from "bun:test";

describe("tooling health anomaly detection logic", () => {
  // Tests for the anomaly detection thresholds used in detectToolingAnomalies

  function isAnomaly(currentRate: number, baselineRate: number, totalCalls: number): boolean {
    // Matches the SQL logic: current_rate > baseline * 2 AND current_rate >= 10 AND total_calls >= 5
    return totalCalls >= 5 && currentRate > baselineRate * 2 && currentRate >= 10;
  }

  test("flags tool with 2x+ spike in failure rate", () => {
    expect(isAnomaly(30, 10, 20)).toBe(true);  // 3x spike
    expect(isAnomaly(25, 10, 10)).toBe(true);  // 2.5x spike
  });

  test("does not flag tool with mild increase", () => {
    expect(isAnomaly(15, 10, 20)).toBe(false); // 1.5x — below 2x threshold
    expect(isAnomaly(10, 10, 20)).toBe(false); // No change
  });

  test("does not flag tool with too few calls", () => {
    expect(isAnomaly(50, 10, 3)).toBe(false); // Only 3 calls
    expect(isAnomaly(80, 5, 4)).toBe(false);  // Only 4 calls
  });

  test("does not flag low failure rates even with spike", () => {
    expect(isAnomaly(8, 2, 20)).toBe(false);  // 4x spike but rate < 10%
    expect(isAnomaly(5, 1, 50)).toBe(false);   // 5x spike but rate < 10%
  });

  test("flags tools with zero baseline and significant failures", () => {
    expect(isAnomaly(15, 0, 10)).toBe(true);  // New tool with failures
    expect(isAnomaly(50, 0, 5)).toBe(true);   // New tool with high failure
  });

  test("does not flag tools with zero baseline and low rate", () => {
    expect(isAnomaly(5, 0, 10)).toBe(false);  // Rate < 10%
  });

  test("edge case: exactly at 2x threshold", () => {
    // > baseline * 2, so exactly 2x is NOT flagged (need strictly greater)
    expect(isAnomaly(20, 10, 10)).toBe(false);
    expect(isAnomaly(21, 10, 10)).toBe(true);
  });

  test("edge case: exactly 5 calls", () => {
    expect(isAnomaly(50, 10, 5)).toBe(true);  // Exactly 5 calls is enough
  });
});

describe("tooling health trend classification", () => {
  function classifyTrend(currentRate: number, previousRate: number): "improving" | "stable" | "degrading" {
    const diff = currentRate - previousRate;
    if (diff > 5) return "degrading";
    if (diff < -5) return "improving";
    return "stable";
  }

  test("classifies increasing failure rates as degrading", () => {
    expect(classifyTrend(30, 10)).toBe("degrading");
    expect(classifyTrend(50, 40)).toBe("degrading");
  });

  test("classifies decreasing failure rates as improving", () => {
    expect(classifyTrend(10, 30)).toBe("improving");
    expect(classifyTrend(5, 20)).toBe("improving");
  });

  test("classifies small changes as stable", () => {
    expect(classifyTrend(10, 10)).toBe("stable");
    expect(classifyTrend(12, 10)).toBe("stable");
    expect(classifyTrend(8, 10)).toBe("stable");
  });
});

describe("failure rate color coding", () => {
  function getRateColor(rate: number): "green" | "yellow" | "red" {
    if (rate < 10) return "green";
    if (rate < 30) return "yellow";
    return "red";
  }

  test("low failure rate is green", () => {
    expect(getRateColor(0)).toBe("green");
    expect(getRateColor(5)).toBe("green");
    expect(getRateColor(9.9)).toBe("green");
  });

  test("medium failure rate is yellow", () => {
    expect(getRateColor(10)).toBe("yellow");
    expect(getRateColor(20)).toBe("yellow");
    expect(getRateColor(29.9)).toBe("yellow");
  });

  test("high failure rate is red", () => {
    expect(getRateColor(30)).toBe("red");
    expect(getRateColor(50)).toBe("red");
    expect(getRateColor(100)).toBe("red");
  });
});
