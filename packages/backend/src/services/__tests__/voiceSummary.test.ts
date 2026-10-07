import { describe, expect, test } from "bun:test";
import {
  VOICE,
  buildVoicePrompt,
  spokenLimits,
  toSpokenText,
  voiceAudioBody,
  voiceSummaryBody,
} from "../voiceSummary";

describe("voiceSummaryBody", () => {
  test("accepts a minimal permission request", () => {
    const r = voiceSummaryBody.safeParse({ trigger: "permission", project: "devscope-cloud", tool: "Bash" });
    expect(r.success).toBe(true);
  });

  test("accepts a reply summary request", () => {
    const r = voiceSummaryBody.safeParse({ trigger: "reply", project: "devscope", last_message: "Done." });
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

describe("buildVoicePrompt (reply)", () => {
  test("asks for a short summary of the reply, outcome first", () => {
    const text = buildVoicePrompt({ trigger: "reply", project: "plugin", last_message: "All 40 tests pass." })[0]
      .parts![0].text!;
    expect(text).toContain("Project: plugin");
    expect(text).toContain("Claude's reply: All 40 tests pass.");
    expect(text).toContain("outcome first");
    expect(text).toContain(`At most ${VOICE.replyMaxWords} words`);
    expect(text).not.toContain("Situation:");
  });

  test("keeps far more of the reply than the announcer does", () => {
    const text = buildVoicePrompt({ trigger: "reply", project: "p", last_message: "y".repeat(3500) })[0].parts![0]
      .text!;
    expect(text).toContain("y".repeat(3500));
  });
});

describe("spokenLimits", () => {
  test("replies may run longer than announcements but fit one audio request", () => {
    expect(spokenLimits("permission")).toEqual({ maxWords: VOICE.maxWords, maxChars: VOICE.maxChars });
    const reply = spokenLimits("reply");
    expect(reply.maxWords).toBeGreaterThan(VOICE.maxWords);
    expect(reply.maxChars).toBeLessThanOrEqual(VOICE.maxChars * 2);
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

  test("takes the reply limits", () => {
    const out = toSpokenText(
      Array.from({ length: 80 }, (_, i) => `w${i}`).join(" "),
      spokenLimits("reply"),
    );
    expect(out.split(" ").length).toBe(VOICE.replyMaxWords);
  });

  test("returns empty for empty model output", () => {
    expect(toSpokenText("  ``` ```  ")).toBe("");
  });
});

describe("voiceAudioBody", () => {
  test("accepts text with optional voice and speed", () => {
    expect(voiceAudioBody.safeParse({ text: "cloud needs you" }).success).toBe(true);
    expect(voiceAudioBody.safeParse({ text: "hi", voice: "am_michael", speed: 1.5 }).success).toBe(true);
  });

  test("rejects empty or oversized text, odd voice names and extreme speeds", () => {
    expect(voiceAudioBody.safeParse({ text: " " }).success).toBe(false);
    expect(voiceAudioBody.safeParse({ text: "x".repeat(VOICE.maxChars * 2 + 1) }).success).toBe(false);
    expect(voiceAudioBody.safeParse({ text: "hi", voice: "../etc" }).success).toBe(false);
    expect(voiceAudioBody.safeParse({ text: "hi", speed: 5 }).success).toBe(false);
  });
});
