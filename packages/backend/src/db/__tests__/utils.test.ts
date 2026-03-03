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

  test("single ID produces correct escaped SQL fragment", () => {
    inList(["abc123"]);
    expect(unsafeSpy).toHaveBeenCalledTimes(1);
    expect(unsafeSpy.mock.calls[0][0]).toBe("'abc123'");
  });

  test("multiple IDs joined with commas", () => {
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

  test("returns the result of Sql.unsafe", () => {
    const result = inList(["deadbeef"]);
    expect(result).toEqual({ __raw: "'deadbeef'" });
  });

  // --- Empty array ---

  test("empty array returns Sql.unsafe('NULL')", () => {
    inList([]);
    expect(unsafeSpy).toHaveBeenCalledTimes(1);
    expect(unsafeSpy.mock.calls[0][0]).toBe("NULL");
  });

  // --- SQL injection prevention via quote escaping ---

  test("escapes single quotes in IDs", () => {
    inList(["it's"]);
    expect(unsafeSpy.mock.calls[0][0]).toBe("'it''s'");
  });

  test("escapes SQL injection attempt with single quotes", () => {
    inList(["' OR '1'='1"]);
    const escaped = unsafeSpy.mock.calls[0][0];
    // Single quotes are doubled, preventing injection breakout
    expect(escaped).toBe("''' OR ''1''=''1'");
  });

  test("handles IDs with special characters", () => {
    inList(["abc-123", "def_456"]);
    expect(unsafeSpy.mock.calls[0][0]).toBe("'abc-123','def_456'");
  });

  test("handles IDs with spaces", () => {
    inList(["abc 123"]);
    expect(unsafeSpy.mock.calls[0][0]).toBe("'abc 123'");
  });

  test("handles mixed IDs correctly", () => {
    inList(["normal", "has'quote", "also-fine"]);
    expect(unsafeSpy.mock.calls[0][0]).toBe("'normal','has''quote','also-fine'");
  });
});
