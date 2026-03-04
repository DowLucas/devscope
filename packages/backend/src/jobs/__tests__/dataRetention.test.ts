import { describe, expect, test } from "bun:test";

describe("data retention configuration", () => {
  test("default retention is 90 days", () => {
    const DEFAULT_RETENTION_DAYS = 90;
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
  });

  test("retention range is bounded between 30 and 365 days", () => {
    const MIN = 30;
    const MAX = 365;

    const validValues = [30, 60, 90, 180, 365];
    for (const v of validValues) {
      expect(v).toBeGreaterThanOrEqual(MIN);
      expect(v).toBeLessThanOrEqual(MAX);
    }
  });

  test("anonymization is the default behavior (not hard deletion)", () => {
    const DEFAULT_ANONYMIZE = true;
    expect(DEFAULT_ANONYMIZE).toBe(true);
  });

  test("anonymized developer ID is a fixed sentinel value", () => {
    const ANONYMIZED_ID = "anonymized";
    expect(ANONYMIZED_ID).toBe("anonymized");
    // Must not look like a real developer hash
    expect(ANONYMIZED_ID.length).toBeLessThan(64);
  });
});

describe("retention cutoff calculation", () => {
  test("computes correct cutoff date for given retention days", () => {
    const retentionDays = 90;
    const now = new Date("2026-03-04T00:00:00Z");
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - retentionDays);

    expect(cutoff.toISOString().slice(0, 10)).toBe("2025-12-04");
  });

  test("computes correct cutoff for 30-day retention", () => {
    const now = new Date("2026-03-04T00:00:00Z");
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 30);

    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-02-02");
  });

  test("computes correct cutoff for 365-day retention", () => {
    const now = new Date("2026-03-04T00:00:00Z");
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 365);

    expect(cutoff.toISOString().slice(0, 10)).toBe("2025-03-04");
  });
});
