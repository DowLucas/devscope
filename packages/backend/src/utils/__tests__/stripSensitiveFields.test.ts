import { describe, expect, test } from "bun:test";
import {
  stripSensitivePayload,
  stripSensitiveEvent,
} from "../stripSensitiveFields";

// ---------------------------------------------------------------------------
// stripSensitivePayload
// ---------------------------------------------------------------------------
describe("stripSensitivePayload", () => {
  test("removes all three sensitive keys when present", () => {
    const payload = {
      toolName: "bash",
      promptText: "secret prompt",
      toolInput: "secret input",
      responseText: "secret response",
      duration: 42,
    };
    const result = stripSensitivePayload(payload);

    expect(result).toEqual({ toolName: "bash", duration: 42 });
    expect(result).not.toHaveProperty("promptText");
    expect(result).not.toHaveProperty("toolInput");
    expect(result).not.toHaveProperty("responseText");
  });

  test("handles payload with only some sensitive keys", () => {
    const payload = {
      toolName: "read",
      promptText: "partial secret",
      success: true,
    };
    const result = stripSensitivePayload(payload);

    expect(result).toEqual({ toolName: "read", success: true });
    expect(result).not.toHaveProperty("promptText");
  });

  test("returns a copy unchanged when no sensitive keys exist", () => {
    const payload = { toolName: "write", duration: 100 };
    const result = stripSensitivePayload(payload);

    expect(result).toEqual({ toolName: "write", duration: 100 });
  });

  test("handles an empty payload", () => {
    const result = stripSensitivePayload({});
    expect(result).toEqual({});
  });

  test("does not mutate the original payload", () => {
    const original = {
      toolName: "bash",
      promptText: "secret",
      toolInput: "also secret",
      responseText: "very secret",
    };
    const frozen = { ...original };

    stripSensitivePayload(original);

    expect(original).toEqual(frozen);
    expect(original).toHaveProperty("promptText");
    expect(original).toHaveProperty("toolInput");
    expect(original).toHaveProperty("responseText");
  });

  test("preserves non-sensitive keys with various value types", () => {
    const payload = {
      promptText: "remove me",
      count: 0,
      flag: false,
      nothing: null,
      nested: { a: 1 },
      list: [1, 2, 3],
    };
    const result = stripSensitivePayload(payload);

    expect(result).toEqual({
      count: 0,
      flag: false,
      nothing: null,
      nested: { a: 1 },
      list: [1, 2, 3],
    });
  });
});

// ---------------------------------------------------------------------------
// stripSensitiveEvent
// ---------------------------------------------------------------------------
describe("stripSensitiveEvent", () => {
  test("strips sensitive fields from the nested payload", () => {
    const event = {
      id: "evt-1",
      type: "tool_use",
      payload: {
        toolName: "bash",
        promptText: "secret prompt",
        toolInput: "secret input",
        responseText: "secret response",
        duration: 10,
      },
    };
    const result = stripSensitiveEvent(event);

    expect(result).toEqual({
      id: "evt-1",
      type: "tool_use",
      payload: { toolName: "bash", duration: 10 },
    });
  });

  test("returns the event as-is when payload is missing", () => {
    const event = { id: "evt-2", type: "session_start" };
    const result = stripSensitiveEvent(event);

    expect(result).toBe(event); // exact same reference
  });

  test("returns the event as-is when payload is null", () => {
    const event = { id: "evt-3", type: "session_start", payload: null };
    const result = stripSensitiveEvent(event);

    expect(result).toBe(event);
  });

  test("returns the event as-is when payload is a string", () => {
    const event = { id: "evt-4", type: "info", payload: "not-an-object" };
    const result = stripSensitiveEvent(event);

    expect(result).toBe(event);
  });

  test("returns the event as-is when payload is a number", () => {
    const event = { id: "evt-5", type: "info", payload: 42 };
    const result = stripSensitiveEvent(event);

    expect(result).toBe(event);
  });

  test("returns the event as-is when payload is a boolean", () => {
    const event = { id: "evt-6", type: "info", payload: true };
    const result = stripSensitiveEvent(event);

    expect(result).toBe(event);
  });

  test("does not mutate the original event or its payload", () => {
    const event = {
      id: "evt-7",
      type: "tool_use",
      payload: {
        toolName: "bash",
        promptText: "secret",
        responseText: "also secret",
      },
    };
    const originalPayload = { ...event.payload };

    stripSensitiveEvent(event);

    expect(event.payload).toEqual(originalPayload);
    expect(event.payload).toHaveProperty("promptText");
    expect(event.payload).toHaveProperty("responseText");
  });

  test("preserves all non-payload event fields", () => {
    const event = {
      id: "evt-8",
      type: "tool_use",
      timestamp: "2026-03-03T00:00:00Z",
      sessionId: "sess-1",
      developerId: "dev-abc",
      payload: { toolName: "read", promptText: "strip me" },
    };
    const result = stripSensitiveEvent(event);

    expect(result.id).toBe("evt-8");
    expect(result.type).toBe("tool_use");
    expect(result.timestamp).toBe("2026-03-03T00:00:00Z");
    expect(result.sessionId).toBe("sess-1");
    expect(result.developerId).toBe("dev-abc");
    expect(result.payload).toEqual({ toolName: "read" });
  });

  test("handles payload that is an empty object", () => {
    const event = { id: "evt-9", type: "empty", payload: {} };
    const result = stripSensitiveEvent(event);

    expect(result).toEqual({ id: "evt-9", type: "empty", payload: {} });
    // Should still return a new object (spread), not the same reference
    expect(result).not.toBe(event);
  });

  test("handles payload with only sensitive keys (results in empty payload)", () => {
    const event = {
      id: "evt-10",
      type: "tool_use",
      payload: {
        promptText: "a",
        toolInput: "b",
        responseText: "c",
      },
    };
    const result = stripSensitiveEvent(event);

    expect(result).toEqual({
      id: "evt-10",
      type: "tool_use",
      payload: {},
    });
  });
});
