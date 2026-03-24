import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { callGemini, TEMPERATURE } from "../gemini";
import {
  getSessionFeedbackData,
  recordTokenUsage,
  createReport,
  updateReport,
} from "../../db";
import type { AiReport } from "@devscope/shared";

const FeedbackState = Annotation.Root({
  sessionId: Annotation<string>,
  privacyMode: Annotation<string | null>,
  isSelfView: Annotation<boolean>,
  includeContent: Annotation<boolean>,
  data: Annotation<Record<string, unknown>>,
  content: Annotation<string>,
  reportId: Annotation<string>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type FeedbackStateType = typeof FeedbackState.State;

async function gatherData(
  state: FeedbackStateType,
  sql: SQL
): Promise<Partial<FeedbackStateType>> {
  const includeContent = state.isSelfView && state.privacyMode === "open";
  const feedbackData = await getSessionFeedbackData(sql, state.sessionId, includeContent);

  if (!feedbackData) {
    return { data: {}, includeContent };
  }

  return {
    includeContent,
    data: feedbackData as unknown as Record<string, unknown>,
  };
}

async function generateFeedback(
  state: FeedbackStateType,
  sql: SQL
): Promise<Partial<FeedbackStateType>> {
  // Create the report record first
  const report = await createReport(sql, {
    report_type: "session",
    title: `Session Debrief — ${new Date().toLocaleDateString()}`,
    period_start: undefined,
    period_end: undefined,
  });

  if (!state.data || Object.keys(state.data).length === 0) {
    await updateReport(sql, report.id, {
      content_markdown: "# Session Debrief\n\nSession data could not be loaded.",
      data_context: { session_id: state.sessionId, privacy_mode: state.privacyMode, content_included: false },
      status: "completed",
    });
    return { reportId: report.id, content: "Session data could not be loaded." };
  }

  const data = state.data as any;
  const privacyMode = state.privacyMode ?? "standard";
  const includeContent = state.includeContent;

  const privacyExplainer = includeContent
    ? `This debrief has access to your full session content (prompts, tool inputs, and responses) because your session privacy mode is **open**. Suggestions will be specific and grounded in your actual prompts and interactions.`
    : privacyMode === "private"
    ? `This session is in **private** mode — no content details are available.`
    : privacyMode === "open"
    ? `This debrief is based on session **metadata only** (tool names, event counts, error messages) because you are viewing another developer's session. Content is only included for self-views.`
    : `This debrief is based on session **metadata only** (tool names, event counts, error messages) because your session privacy mode is **standard**. Set \`DEVSCOPE_PRIVACY=open\` for richer, content-aware suggestions.`;

  const dataStr = JSON.stringify(state.data, null, 2).slice(0, 20_000);

  const contentSections = includeContent
    ? `
When producing CLAUDE.md suggestions and skill definitions, use specific patterns from the prompt samples, tool input/output samples, and response samples where relevant. Tool results show what Claude Code actually read, searched, or executed — use these to understand what the developer was working on and where friction occurred. Reference what topics or tasks were being worked on, but do NOT reproduce sensitive prompt or response text verbatim.`
    : `
Since only metadata is available (no prompt or response content), base CLAUDE.md suggestions on the tool failure error messages and tool usage patterns. Keep suggestions practical and general.`;

  const response = await callGemini(
    [
      {
        role: "user",
        parts: [
          {
            text: `You are DevScope AI, a helpful assistant for improving developer workflows with Claude Code.

Produce a **Session Debrief** in Markdown for the following session data. The output is read by the developer themselves — it's personal and actionable.

---

## Privacy Context
${privacyExplainer}
${contentSections}

---

## Session Data
${dataStr}

---

## Required Sections (use these exact headings):

### Session Summary
Brief overview: project, duration, what was worked on (infer from tool usage and project name), key stats (prompts, tool calls, failure rate).

### What Went Well
Highlight effective tool usage patterns, successful tool sequences, or productive patterns observed.

### Friction Points
Identify where Claude Code struggled: tool failures with their error messages, repeated failures on the same tool, missing context that caused confusion, anti-patterns (retry loops, etc.).

### Improve Your CLAUDE.md
Based on the friction points and context gaps, suggest **specific additions** to the project's CLAUDE.md. Format each suggestion as a markdown code block showing the exact text to add. Include a brief explanation of why each addition helps.

Example format:
**Suggestion: Add database query patterns**
*Why: The session had multiple SQL-related failures suggesting Claude Code lacked context about the project's DB layer.*
\`\`\`markdown
## Database
- Uses Bun.sql for all queries (tagged template literals)
- Never use sql.array() — use the inList() helper in src/db/queries.ts instead
\`\`\`

Provide 2-4 specific suggestions relevant to this session.

### Skill Suggestions
If you observe a repeated multi-step pattern (e.g., always reading a config file before editing, or a specific debugging workflow), propose a Claude Code skill definition. Show the skill body in a code block.

Example format:
**Skill: debug-tool-failure**
*When to use: When a tool repeatedly fails with the same error*
\`\`\`
Read the error message carefully, then:
1. Check if the tool input is correctly formatted for this project
2. Look at recent successful uses of the same tool for reference
3. Try a simpler version of the operation first
\`\`\`

Provide 0-2 skill suggestions (only if clear patterns justify them).

### Tips for Next Time
Give 2-3 concrete, session-specific tips for interacting with Claude Code on this project more effectively.

---

Requirements:
- Write in second person ("your session", "you can", "try asking")
- Never mention individual developer names or rankings
- Keep it practical and positive — this is about improving, not judging
- Use specific numbers from the data (e.g. "your 4 Bash failures")
- Total length: 400-1200 words`,
          },
        ],
      },
    ],
    undefined,
    { temperature: TEMPERATURE.report, maxOutputTokens: 4096 }
  );

  // Prepend the privacy mode notice as a callout
  const privacyNotice = `> **Privacy mode: ${privacyMode ?? "standard"}** — ${privacyExplainer}\n\n`;
  const fullContent = privacyNotice + response.text;

  await updateReport(sql, report.id, {
    content_markdown: fullContent,
    data_context: {
      session_id: state.sessionId,
      privacy_mode: privacyMode,
      content_included: includeContent,
    },
    status: "completed",
  });

  return {
    reportId: report.id,
    content: fullContent,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

export function createSessionFeedbackWorkflow(sql: SQL) {
  const workflow = new StateGraph(FeedbackState)
    .addNode("gatherData", (state) => gatherData(state, sql))
    .addNode("generateFeedback", (state) => generateFeedback(state, sql))
    .addEdge(START, "gatherData")
    .addEdge("gatherData", "generateFeedback")
    .addEdge("generateFeedback", END);

  return workflow.compile();
}

export async function runSessionFeedbackWorkflow(
  sql: SQL,
  sessionId: string,
  privacyMode: string | null,
  isSelfView: boolean
): Promise<AiReport> {
  const app = createSessionFeedbackWorkflow(sql);

  const result = await app.invoke({
    sessionId,
    privacyMode,
    isSelfView,
    includeContent: false,
    data: {},
    content: "",
    reportId: "",
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(
    sql,
    "session-feedback",
    "gemini-2.0-flash",
    result.inputTokens,
    result.outputTokens
  );

  const [report] = await sql`SELECT * FROM ai_reports WHERE id = ${result.reportId}`;
  return report as AiReport;
}
