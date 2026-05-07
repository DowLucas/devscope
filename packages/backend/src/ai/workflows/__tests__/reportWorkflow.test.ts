import { describe, expect, test } from "bun:test";
import {
  buildWeeklyBuyerOutlinePrompt,
  buildWeeklyBuyerWritePrompt,
} from "../reportWorkflow";

// Synthetic team-aggregate input. Intentionally contains no developer names,
// emails, or hashes — the test asserts the rendered prompt template carries
// none of those tokens either.
const SYNTHETIC_TEAM_DATA = {
  periodComparison: {
    current: { sessions: 42, events: 1280 },
    previous: { sessions: 30, events: 950 },
    change: { sessions: 0.4, events: 0.347 },
  },
  teamVelocity: { sessionsPerDay: 6, completionRate: 0.91 },
  sessionsNeedingAttention: 3,
  teamActivity: { totalEvents: 1280, totalSessions: 42 },
  projects: [
    { name: "core", sessions: 15 },
    { name: "dashboard", sessions: 12 },
  ],
  toolUsage: [
    { tool: "Bash", count: 300 },
    { tool: "Read", count: 220 },
  ],
  concreteToolDetails: {
    bash: { git: 120, npm: 45 },
    read: { "package.json": 25 },
  },
  sessionSummary: { totalSessions: 42, completedSessions: 38 },
  failureClusters: [{ tool: "Bash", failures: 12, pattern: "git push rejected" }],
  effectivePatterns: [],
  antiPatternSummary: {},
};

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
// Match any 32+ contiguous hex chars — covers MD5, SHA1, SHA256, and the
// developer-id hashes the plugin produces.
const HEX_TOKEN_RE = /\b[a-f0-9]{32,}\b/i;

describe("weekly-buyer prompt template", () => {
  test("outline prompt contains no developer-identifying tokens", () => {
    const prompt = buildWeeklyBuyerOutlinePrompt({
      reportType: "weekly",
      title: "Weekly Team Narrative",
      data: SYNTHETIC_TEAM_DATA,
    });
    expect(prompt).not.toMatch(EMAIL_RE);
    expect(prompt).not.toMatch(HEX_TOKEN_RE);
  });

  test("write prompt contains no developer-identifying tokens", () => {
    const prompt = buildWeeklyBuyerWritePrompt({
      reportType: "weekly",
      title: "Weekly Team Narrative",
      outline: "1. Week summary\n2. What worked\n3. What didn't",
      data: SYNTHETIC_TEAM_DATA,
    });
    expect(prompt).not.toMatch(EMAIL_RE);
    expect(prompt).not.toMatch(HEX_TOKEN_RE);
  });

  test("both prompts forbid individual-developer language", () => {
    const outline = buildWeeklyBuyerOutlinePrompt({
      reportType: "weekly",
      title: "x",
      data: SYNTHETIC_TEAM_DATA,
    });
    const write = buildWeeklyBuyerWritePrompt({
      reportType: "weekly",
      title: "x",
      outline: "",
      data: SYNTHETIC_TEAM_DATA,
    });
    for (const prompt of [outline, write]) {
      expect(prompt).toContain("TEAM-AGGREGATE ONLY");
      // Explicit ban list must call out names, emails, and hashes by name.
      expect(prompt.toLowerCase()).toMatch(/\bnames\b/);
      expect(prompt.toLowerCase()).toMatch(/\bemails\b/);
      expect(prompt.toLowerCase()).toMatch(/\bhashes\b/);
    }
  });

  test("prompts establish Friday-narrative voice", () => {
    const outline = buildWeeklyBuyerOutlinePrompt({
      reportType: "weekly",
      title: "x",
      data: SYNTHETIC_TEAM_DATA,
    });
    const write = buildWeeklyBuyerWritePrompt({
      reportType: "weekly",
      title: "x",
      outline: "",
      data: SYNTHETIC_TEAM_DATA,
    });
    for (const prompt of [outline, write]) {
      expect(prompt.toLowerCase()).toContain("friday-narrative");
      expect(prompt.toLowerCase()).toContain("what worked");
      expect(prompt.toLowerCase()).toContain("what didn't");
      expect(prompt.toLowerCase()).toContain("got stuck");
    }
  });

  test("write prompt reserves a documentation-gaps slot for the doc-gap pipeline", () => {
    // The doc-gap subsection is the integration point for the sibling DEV-48
    // (#12) child issue — it fills the `docGaps` data slot and the prompt
    // renders it. Until that lands, the prompt instructs the LLM to emit a
    // single-line placeholder rather than fabricate gaps.
    const prompt = buildWeeklyBuyerWritePrompt({
      reportType: "weekly",
      title: "x",
      outline: "",
      data: SYNTHETIC_TEAM_DATA,
    });
    expect(prompt).toContain("Documentation gaps");
    expect(prompt).toContain("docGaps");
    expect(prompt).toContain("Doc gap data unavailable for this period.");
  });

  test("write prompt suppresses internal-only sections", () => {
    const prompt = buildWeeklyBuyerWritePrompt({
      reportType: "weekly",
      title: "x",
      outline: "",
      data: SYNTHETIC_TEAM_DATA,
    });
    // The buyer artifact must not carry the internal "Improve Your Claude
    // Code Setup" / "Action Items" / "Claude Code Skills" sections that the
    // team-lead and developer personas produce.
    expect(prompt).toMatch(
      /Do NOT include "Action Items", "Improve Your Claude Code Setup", or "Claude Code Skills"/
    );
  });
});
