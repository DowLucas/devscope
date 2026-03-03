import { describe, expect, test, mock, beforeEach } from "bun:test";

// Track calls to Sql.unsafe
let unsafeCalls: string[] = [];

mock.module("bun", () => ({
  sql: {
    unsafe: (str: string) => {
      unsafeCalls.push(str);
      return { __raw: str };
    },
  },
}));

// Import after mock is set up
import { inList } from "../utils";

beforeEach(() => {
  unsafeCalls = [];
});

describe("inList", () => {
  // --- Valid inputs ---

  test("single valid hex ID produces correct escaped SQL fragment", () => {
    inList(["abc123"]);
    expect(unsafeCalls).toHaveLength(1);
    expect(unsafeCalls[0]).toBe("'abc123'");
  });

  test("multiple valid hex IDs joined with commas", () => {
    inList(["aaa", "bbb", "ccc"]);
    expect(unsafeCalls).toHaveLength(1);
    expect(unsafeCalls[0]).toBe("'aaa','bbb','ccc'");
  });

  test("long SHA-256 hex string is accepted", () => {
    const sha = "a".repeat(64);
    inList([sha]);
    expect(unsafeCalls).toHaveLength(1);
    expect(unsafeCalls[0]).toBe(`'${sha}'`);
  });

  test("all hex digits 0-9 a-f are accepted", () => {
    inList(["0123456789abcdef"]);
    expect(unsafeCalls).toHaveLength(1);
    expect(unsafeCalls[0]).toBe("'0123456789abcdef'");
  });

  test("returns the result of Sql.unsafe", () => {
    const result = inList(["deadbeef"]);
    expect(result).toEqual({ __raw: "'deadbeef'" });
  });

  // --- Invalid inputs: non-hex characters ---

  test("throws for uppercase hex characters", () => {
    expect(() => inList(["ABC123"])).toThrow("inList: invalid ID format: ABC123");
  });

  test("throws for ID containing a dash", () => {
    expect(() => inList(["abc-123"])).toThrow("inList: invalid ID format: abc-123");
  });

  test("throws for ID containing a space", () => {
    expect(() => inList(["abc 123"])).toThrow("inList: invalid ID format: abc 123");
  });

  test("throws for ID containing special characters", () => {
    expect(() => inList(["abc'; DROP TABLE--"])).toThrow("inList: invalid ID format");
  });

  test("throws for ID with underscores", () => {
    expect(() => inList(["abc_def"])).toThrow("inList: invalid ID format: abc_def");
  });

  test("throws for ID with mixed case hex (uppercase G-Z)", () => {
    expect(() => inList(["abcxyz"])).toThrow("inList: invalid ID format: abcxyz");
  });

  // --- Empty string ID ---

  test("throws for empty string ID", () => {
    expect(() => inList([""])).toThrow("inList: invalid ID format: ");
  });

  // --- Mixed valid and invalid ---

  test("throws on first invalid ID in a mixed array", () => {
    expect(() => inList(["aaa", "INVALID", "bbb"])).toThrow(
      "inList: invalid ID format: INVALID"
    );
  });

  test("throws on first invalid when valid IDs precede it", () => {
    expect(() => inList(["deadbeef", "cafebabe", "not-hex"])).toThrow(
      "inList: invalid ID format: not-hex"
    );
  });

  test("does not call Sql.unsafe when validation fails", () => {
    try {
      inList(["valid", "INVALID"]);
    } catch {
      // expected
    }
    // "valid" alone would not pass (contains 'v', 'l', 'i', 'd' — wait, 'v' is not hex)
    // Let's use a truly valid first ID
    unsafeCalls = [];
    try {
      inList(["aabbcc", "INVALID"]);
    } catch {
      // expected
    }
    expect(unsafeCalls).toHaveLength(0);
  });

  // --- Empty array ---

  test("empty array passes validation and calls Sql.unsafe with empty string", () => {
    inList([]);
    expect(unsafeCalls).toHaveLength(1);
    expect(unsafeCalls[0]).toBe("");
  });

  // --- SQL injection prevention ---

  test("rejects single-quote injection attempt", () => {
    expect(() => inList(["' OR '1'='1"])).toThrow("inList: invalid ID format");
  });

  test("rejects semicolon injection attempt", () => {
    expect(() => inList(["abc;DELETE FROM sessions"])).toThrow(
      "inList: invalid ID format"
    );
  });

  test("rejects null byte injection", () => {
    expect(() => inList(["abc\0def"])).toThrow("inList: invalid ID format");
  });

  test("rejects unicode lookalike characters", () => {
    // Full-width 'a' (U+FF41) looks like 'a' but is not ASCII hex
    expect(() => inList(["\uff41bc"])).toThrow("inList: invalid ID format");
  });
});
