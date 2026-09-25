import { describe, expect, test } from "bun:test";
import { VOICE, buildVoicePrompt, toSpokenText, voiceSummaryBody } from "../voiceSummary";

describe("voiceSummaryBody", () => {
  test("accepts a minimal permission request", () => {
    const r = voiceSummaryBody.safeParse({ trigger: "permission", project: "devscope-cloud", tool: "Bash" });
    expect(r.success).toBe(true);
  });

  test("rejects unknown triggers and missing project", () => {
    expect(voiceSummaryBody.safeParse({ trigger: "other", project: "x" }).success).toBe(false);
    expect(voiceSummaryBody.safeParse({ trigger: "failed", project: " " }).success).toBe(false);
  });
});

describe("buildVoicePrompt", () => {
  test("includes only the facts that were given", () => {
    const text = buildVoicePrompt({ trigger: "failed", project: "plugin" })[0].parts![0].text!;
    expect(text).toContain("Project: plugin");
    expect(text).toContain("ended in an error");
    expect(text).not.toContain("Tool:");
    expect(text).not.toContain("last message");
  });

  test("clips long details", () => {
    const text = buildVoicePrompt({
      trigger: "permission",
      project: "p",
      tool: "Bash",
      detail: "x".repeat(2000),
    })[0].parts![0].text!;
    expect(text).toContain("Tool: Bash");
    expect(text.length).toBeLessThan(1500);
  });
});

describe("toSpokenText", () => {
  test("strips markup and collapses whitespace", () => {
    expect(toSpokenText('  **devscope** wants to run `bun test`\n now "please" ')).toBe(
      "devscope wants to run bun test now please",
    );
  });

  test("drops fenced code entirely", () => {
    expect(toSpokenText("cloud needs you ```rm -rf x``` now")).toBe("cloud needs you now");
  });

  test("caps the word count", () => {
    const out = toSpokenText(Array.from({ length: 60 }, (_, i) => `w${i}`).join(" "));
    expect(out.split(" ").length).toBe(VOICE.maxWords);
    expect(out.endsWith(".")).toBe(true);
  });

  test("returns empty for empty model output", () => {
    expect(toSpokenText("  ``` ```  ")).toBe("");
  });
});
