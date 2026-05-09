import { describe, expect, test } from "bun:test";
import { buildTurns } from "../buildTurns";

interface RawEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

function ev(
  id: string,
  event_type: string,
  payload: Record<string, unknown>,
  created_at = "2026-05-08T00:00:00.000Z"
): RawEvent {
  return { id, event_type, payload, created_at };
}

describe("buildTurns — DEV-94 tool_use_id pairing", () => {
  test("pairs concurrent same-tool invocations correctly via toolUseId", () => {
    // Scenario: a parent turn fires two parallel Read calls. Hook events
    // arrive interleaved:
    //   start(Read, tu_a) → start(Read, tu_b) → complete(Read, tu_b, dur=20, success)
    //   → fail(Read, tu_a, error="permission denied")
    // With name-only pairing, complete(tu_b) would attach to start(tu_a)
    // because findLast returns the most recent unfinished name-match.
    // toolUseId pairing must attach each complete to its own start.
    const events: RawEvent[] = [
      ev("p1", "prompt.submit", { promptText: "read both", promptLength: 9 }),
      ev("s1", "tool.start", { toolName: "Read", toolUseId: "tu_a", toolInput: { file_path: "/a" } }),
      ev("s2", "tool.start", { toolName: "Read", toolUseId: "tu_b", toolInput: { file_path: "/b" } }),
      ev("c1", "tool.complete", {
        toolName: "Read",
        toolUseId: "tu_b",
        success: true,
        duration: 20,
        toolInput: { file_path: "/b" },
      }),
      ev("f1", "tool.fail", {
        toolName: "Read",
        toolUseId: "tu_a",
        success: false,
        errorMessage: "permission denied",
        toolInput: { file_path: "/a" },
      }),
      ev("r1", "response.complete", { responseLength: 0, toolsUsed: ["Read"] }),
    ];

    const [turn] = buildTurns(events);
    expect(turn.toolCalls).toHaveLength(2);

    const a = turn.toolCalls.find((c) => c.toolUseId === "tu_a");
    const b = turn.toolCalls.find((c) => c.toolUseId === "tu_b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // tu_a must carry the FAIL signal (and its file_path), not tu_b's
    // 20ms-success signal.
    expect(a!.success).toBe(false);
    expect(a!.errorMessage).toBe("permission denied");
    expect((a!.toolInput as { file_path?: string } | undefined)?.file_path).toBe("/a");

    // tu_b must carry the SUCCESS / 20ms duration.
    expect(b!.success).toBe(true);
    expect(b!.duration).toBe(20);
    expect((b!.toolInput as { file_path?: string } | undefined)?.file_path).toBe("/b");
  });

  test("falls back to name+subcommand pairing when toolUseId is absent (older plugin)", () => {
    const events: RawEvent[] = [
      ev("p1", "prompt.submit", { promptText: "old plugin run", promptLength: 14 }),
      ev("s1", "tool.start", { toolName: "Bash", toolSubcommand: "ls" }),
      ev("c1", "tool.complete", {
        toolName: "Bash",
        toolSubcommand: "ls",
        success: true,
        duration: 5,
      }),
    ];

    const [turn] = buildTurns(events);
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].success).toBe(true);
    expect(turn.toolCalls[0].duration).toBe(5);
    expect(turn.toolCalls[0].toolUseId).toBeUndefined();
  });

  test("does not collapse a toolUseId-tagged complete into a different toolUseId start", () => {
    // Both events carry toolUseIds but they don't match. The complete must
    // NOT attach to the start by name — keeping the start visible as still-
    // running so a late complete can land on it later.
    const events: RawEvent[] = [
      ev("p1", "prompt.submit", { promptText: "x", promptLength: 1 }),
      ev("s1", "tool.start", { toolName: "Read", toolUseId: "tu_a" }),
      ev("c1", "tool.complete", {
        toolName: "Read",
        toolUseId: "tu_b",
        success: true,
        duration: 7,
      }),
    ];

    const [turn] = buildTurns(events);
    expect(turn.toolCalls).toHaveLength(2);
    const a = turn.toolCalls.find((c) => c.toolUseId === "tu_a");
    const b = turn.toolCalls.find((c) => c.toolUseId === "tu_b");
    expect(a?.success).toBeUndefined();
    expect(b?.success).toBe(true);
    expect(b?.duration).toBe(7);
  });
});
