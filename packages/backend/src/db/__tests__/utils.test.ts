import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { sql as Sql } from "bun";
import { inList } from "../utils";

const unsafeSpy = spyOn(Sql, "unsafe").mockImplementation(
  (str: string) => ({ __raw: str }) as any
);

beforeEach(() => {
  unsafeSpy.mockClear();
});

describe("inList", () => {
  // --- Valid inputs ---

  test("single valid hex ID produces correct escaped SQL fragment", () => {
    inList(["abc123"]);
    expect(unsafeSpy).toHaveBeenCalledTimes(1);
    expect(unsafeSpy.mock.calls[0][0]).toBe("'abc123'");
  });

  test("multiple valid hex IDs joined with commas", () => {
    inList(["aaa", "bbb", "ccc"]);
    expect(unsafeSpy).toHaveBeenCalledTimes(1);
    expect(unsafeSpy.mock.calls[0][0]).toBe("'aaa','bbb','ccc'");
  });

  test("long SHA-256 hex string is accepted", () => {
    const sha = "a".repeat(64);
    inList([sha]);
    expect(unsafeSpy).toHaveBeenCalledTimes(1);
    expect(unsafeSpy.mock.calls[0][0]).toBe(`'${sha}'`);
  });

  test("all hex digits 0-9 a-f are accepted", () => {
    inList(["0123456789abcdef"]);
    expect(unsafeSpy).toHaveBeenCalledTimes(1);
    expect(unsafeSpy.mock.calls[0][0]).toBe("'0123456789abcdef'");
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

  test("throws for ID with non-hex lowercase letters (g-z)", () => {
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

  test("throws when last ID is invalid", () => {
    expect(() => inList(["deadbeef", "cafebabe", "not-hex"])).toThrow(
      "inList: invalid ID format: not-hex"
    );
  });

  test("does not call Sql.unsafe when validation fails", () => {
    try {
      inList(["aabbcc", "INVALID"]);
    } catch {
      // expected
    }
    expect(unsafeSpy).not.toHaveBeenCalled();
  });

  // --- Empty array ---

  test("empty array passes validation and calls Sql.unsafe with empty string", () => {
    inList([]);
    expect(unsafeSpy).toHaveBeenCalledTimes(1);
    expect(unsafeSpy.mock.calls[0][0]).toBe("");
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
    expect(() => inList(["\uff41bc"])).toThrow("inList: invalid ID format");
  });
});
