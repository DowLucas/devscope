import { describe, expect, test } from "bun:test";
import {
  LABEL_MAX_CHARS,
  REPLY_LENGTHS,
  VOICE,
  branchTopic,
  buildVoicePrompt,
  sessionLabel,
  sessionTopic,
  spokenLimits,
  titleTopic,
  toSpokenText,
  voiceAudioBody,
  voiceSummaryBody,
  voiceThinkingBudget,
  withLabel,
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
    // The 2000-character detail is clipped to 600 (599 kept plus an ellipsis).
    expect(text).toContain("x".repeat(599));
    expect(text).not.toContain("x".repeat(600));
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

describe("reply length (verbosity)", () => {
  const prompt = (length?: "short" | "normal" | "long") =>
    buildVoicePrompt({ trigger: "reply", project: "p", last_message: "Done.", ...(length ? { length } : {}) })[0].parts![0].text!;

  test("absent means normal, as older plugins send it", () => {
    expect(prompt()).toBe(prompt("normal"));
    expect(voiceSummaryBody.safeParse({ trigger: "reply", project: "p", length: "long" }).success).toBe(true);
    expect(voiceSummaryBody.safeParse({ trigger: "reply", project: "p", length: "huge" }).success).toBe(false);
  });

  test("each level asks for its own length and caps it", () => {
    expect(prompt("short")).toContain("one short sentence");
    expect(prompt("short")).toContain(`At most ${REPLY_LENGTHS.short.maxWords} words`);
    expect(prompt("long")).toContain("four to six");
    expect(spokenLimits("reply", "short").maxWords).toBeLessThan(spokenLimits("reply").maxWords);
    expect(spokenLimits("reply", "long").maxWords).toBeGreaterThan(spokenLimits("reply").maxWords);
    // The announcer is never affected.
    expect(spokenLimits("permission", "long")).toEqual(spokenLimits("permission"));
  });
});

describe("voiceThinkingBudget", () => {
  test("off for 2.5 Flash, the model's default elsewhere", () => {
    expect(voiceThinkingBudget("gemini-2.5-flash")).toBe(0);
    expect(voiceThinkingBudget("gemini-2.5-flash-lite")).toBe(0);
    expect(voiceThinkingBudget("gemini-2.5-pro")).toBeUndefined();
    expect(voiceThinkingBudget("gemini-3-flash")).toBeUndefined();
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

  test("keeps identifiers' underscores for speakable, drops emphasis and an echoed label", () => {
    expect(toSpokenText("Project: devscope _really_ fixed __init__ and _ds_voice_speak")).toBe(
      "devscope really fixed init and ds_voice_speak",
    );
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

describe("session labels", () => {
  test("a branch becomes words, and main-like branches say nothing", () => {
    expect(branchTopic("feat/oauth-login")).toBe("oauth login");
    expect(branchTopic("lucas/fix_rate-limit")).toBe("fix rate limit");
    expect(branchTopic("main")).toBeNull();
    expect(branchTopic("Master")).toBeNull();
    expect(branchTopic(null)).toBeNull();
    expect(branchTopic("feat/a-very-long-branch-name-for-this")).toBe("a very long branch name");
  });

  test("a title loses closing punctuation and is kept short", () => {
    expect(titleTopic("Fix the rate limiter.")).toBe("Fix the rate limiter");
    expect(titleTopic("Add OAuth sign-in to the login form and tests")).toBe("Add OAuth sign-in to the login");
    expect(titleTopic("  ")).toBeNull();
  });

  test("the topic is the title, else the branch, never for private sessions", () => {
    const row = { current_title: "Rate limiter fix", git_branch: "fix/rate-limit", privacy_mode: "standard" };
    expect(sessionTopic(row)).toBe("Rate limiter fix");
    expect(sessionTopic({ ...row, current_title: null })).toBe("rate limit");
    expect(sessionTopic({ ...row, privacy_mode: "private" })).toBeNull();
    expect(sessionTopic({ current_title: null, git_branch: "main", privacy_mode: null })).toBeNull();
  });

  test("the label is project plus topic, cut to whole words", () => {
    expect(sessionLabel("api-service", "rate limiter fix")).toBe("api-service, rate limiter fix");
    expect(sessionLabel("api-service", null)).toBe("api-service");
    const long = sessionLabel("api-service", "x".repeat(30) + " " + "y".repeat(30) + " zzz");
    expect(long.length).toBeLessThanOrEqual(LABEL_MAX_CHARS);
    expect(long.endsWith(" ")).toBe(false);
  });

  test("the label is spoken first, as its own sentence", () => {
    expect(withLabel("api-service, rate limiter fix", "It needs approval to run the tests."))
      .toBe("api-service, rate limiter fix. It needs approval to run the tests.");
    expect(withLabel(null, "Done.")).toBe("Done.");
  });

  test("with a label, the prompt tells the model not to repeat the project", () => {
    const input = voiceSummaryBody.parse({ trigger: "permission", project: "api", session_id: "s1" });
    const labelled = buildVoicePrompt(input, true)[0].parts![0].text!;
    const plain = buildVoicePrompt(input)[0].parts![0].text!;
    expect(labelled).toContain("do not repeat the project name");
    expect(labelled).not.toContain("Start with the project name");
    expect(plain).toContain("Start with the project name");
    const reply = voiceSummaryBody.parse({ trigger: "reply", project: "api", last_message: "Done." });
    expect(buildVoicePrompt(reply, true)[0].parts![0].text!).toContain("do not repeat the project name");
  });

  test("the body accepts a session id and a returned label, within limits", () => {
    expect(voiceSummaryBody.safeParse({ trigger: "finished", project: "api", session_id: "s1", label: "api, x" }).success).toBe(true);
    expect(voiceSummaryBody.safeParse({ trigger: "finished", project: "api", label: "x".repeat(LABEL_MAX_CHARS + 1) }).success).toBe(false);
  });
});
