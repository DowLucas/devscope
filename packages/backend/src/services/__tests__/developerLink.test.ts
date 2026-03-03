import { describe, expect, test } from "bun:test";
import { computeDeveloperId } from "../developerLink";

describe("computeDeveloperId", () => {
  test("returns a deterministic hash for the same email", () => {
    const hash1 = computeDeveloperId("alice@example.com");
    const hash2 = computeDeveloperId("alice@example.com");
    expect(hash1).toBe(hash2);
  });

  test("returns a 64-character lowercase hex string", () => {
    const hash = computeDeveloperId("bob@example.com");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("normalizes email to lowercase before hashing", () => {
    const lower = computeDeveloperId("alice@example.com");
    const upper = computeDeveloperId("ALICE@EXAMPLE.COM");
    const mixed = computeDeveloperId("Alice@Example.Com");
    expect(lower).toBe(upper);
    expect(lower).toBe(mixed);
  });

  test("trims whitespace before hashing", () => {
    const plain = computeDeveloperId("alice@example.com");
    const leadingSpace = computeDeveloperId("  alice@example.com");
    const trailingSpace = computeDeveloperId("alice@example.com  ");
    const bothSpaces = computeDeveloperId("  alice@example.com  ");
    expect(plain).toBe(leadingSpace);
    expect(plain).toBe(trailingSpace);
    expect(plain).toBe(bothSpaces);
  });

  test("handles combined case and whitespace normalization", () => {
    const canonical = computeDeveloperId("alice@example.com");
    const messy = computeDeveloperId("  ALICE@EXAMPLE.COM  ");
    expect(canonical).toBe(messy);
  });

  test("produces different hashes for different emails", () => {
    const hash1 = computeDeveloperId("alice@example.com");
    const hash2 = computeDeveloperId("bob@example.com");
    expect(hash1).not.toBe(hash2);
  });

  test("matches a known SHA-256 digest", () => {
    // SHA-256 of "alice@example.com" — verified independently
    const expected = new Bun.CryptoHasher("sha256")
      .update("alice@example.com")
      .digest("hex");
    const result = computeDeveloperId("alice@example.com");
    expect(result).toBe(expected);
  });
});
