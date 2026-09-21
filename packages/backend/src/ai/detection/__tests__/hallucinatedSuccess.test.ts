import { describe, expect, test } from "bun:test";
import type { ToolEvent } from "../../../db/patternQueries";
import { detectHallucinatedSuccess } from "../hallucinatedSuccess";

function tool(name: string, success = true): ToolEvent {
  return {
    tool_name: name,
    event_type: success ? "tool.complete" : "tool.fail",
    success,
    created_at: "2026-05-04T00:00:00Z",
  };
}

describe("detectHallucinatedSuccess", () => {
  test("returns null for empty response text", () => {
    expect(
      detectHallucinatedSuccess({ toolSequence: [tool("Read")], responseText: "" }),
    ).toBeNull();
    expect(
      detectHallucinatedSuccess({ toolSequence: [tool("Read")], responseText: null }),
    ).toBeNull();
  });

  test("returns null when response has no success language", () => {
    expect(
      detectHallucinatedSuccess({
        toolSequence: [tool("Read"), tool("Edit")],
        responseText: "Here's what I found in the file.",
      }),
    ).toBeNull();
  });

  test("flags claim-without-tools as warning", () => {
    const r = detectHallucinatedSuccess({
      toolSequence: [],
      responseText: "All done — the bug is fixed.",
    });
    expect(r).not.toBeNull();
    expect(r!.rule).toBe("hallucinated_success");
    expect(r!.severity).toBe("warning");
  });

  test("flags 'tests pass' when only Read/Edit ran", () => {
    const seq = [tool("Read"), tool("Edit"), tool("Read"), tool("Edit")];
    const r = detectHallucinatedSuccess({
      toolSequence: seq,
      responseText: "Tests pass and the build succeeds.",
    });
    expect(r).not.toBeNull();
    expect(r!.details.trailing_tools).toContain("Edit");
  });

  test("does NOT flag when Bash with verification subcommand ran", () => {
    const seq = [tool("Edit"), tool("Bash"), tool("Bash")];
    const r = detectHallucinatedSuccess({
      toolSequence: seq,
      bashSubcommandsTrailing: [undefined, "npm test", "npm run build"],
      responseText: "All tests pass!",
    });
    expect(r).toBeNull();
  });

  test("does NOT flag when playwright verification ran", () => {
    const seq = [tool("Edit"), tool("mcp__playwright__browser_navigate")];
    const r = detectHallucinatedSuccess({
      toolSequence: seq,
      responseText: "Done — feature works.",
    });
    expect(r).toBeNull();
  });

  test("flags when Bash ran but only with non-verification subcommands", () => {
    const seq = [tool("Edit"), tool("Bash"), tool("Bash")];
    const r = detectHallucinatedSuccess({
      toolSequence: seq,
      bashSubcommandsTrailing: [undefined, "ls", "cat"],
      responseText: "All done.",
    });
    expect(r).not.toBeNull();
  });

  test("conservative: undefined Bash subcommand info → do not flag", () => {
    const seq = [tool("Edit"), tool("Bash")];
    const r = detectHallucinatedSuccess({
      toolSequence: seq,
      // no bashSubcommandsTrailing provided
      responseText: "All done.",
    });
    expect(r).toBeNull();
  });
});
