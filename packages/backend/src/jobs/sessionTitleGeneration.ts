import type { SQL } from "bun";
import { isAiAvailable, callGemini, DEFAULT_MODEL } from "../ai/gemini";
import {
  getSessionsNeedingTitles,
  getSessionEventsForTitle,
  saveSessionTitle,
} from "../db";
import { recordTokenUsage } from "../db/aiQueries";
import { broadcastToOrg } from "../ws/handler";
import { getOrgDeveloperIds } from "../services/developerLink";

const CHECK_INTERVAL_MS = 60_000;

const TITLE_INTERVAL_MINUTES = Math.max(
  Number(process.env.SESSION_TITLE_INTERVAL_MINUTES ?? 3),
  1
);

export function startSessionTitleGeneration(sql: SQL) {
  const g = globalThis as any;

  if (g.__gc_session_title_interval) {
    clearInterval(g.__gc_session_title_interval);
  }

  if (!isAiAvailable()) {
    console.log("[session-titles] Skipped — GEMINI_API_KEY not set");
    return;
  }

  async function check() {
    try {
      const orgs = await sql`SELECT id FROM organization`;

      for (const org of orgs as any[]) {
        const orgId = org.id;
        const devIds = await getOrgDeveloperIds(sql, orgId);
        if (devIds.length === 0) continue;

        const sessions = await getSessionsNeedingTitles(
          sql,
          TITLE_INTERVAL_MINUTES,
          devIds
        );

        for (const session of sessions as any[]) {
          try {
            const events = (await getSessionEventsForTitle(
              sql,
              session.id
            )) as any[];
            if (events.length === 0) continue;

            const summary = formatEventsForPrompt(
              events,
              session.project_name
            );

            const response = await callGemini(
              [{ role: "user", parts: [{ text: buildPrompt(summary) }] }],
              undefined,
              { temperature: 0.3, maxOutputTokens: 100 }
            );

            const title = response.text.trim().replace(/^["']|["']$/g, "");
            if (!title || title.length > 80) continue;

            // Skip if title hasn't meaningfully changed
            if (title === session.current_title) continue;

            await saveSessionTitle(
              sql,
              session.id,
              title,
              response.inputTokens,
              response.outputTokens
            );

            await recordTokenUsage(
              sql,
              "session_title",
              DEFAULT_MODEL,
              response.inputTokens,
              response.outputTokens,
              orgId
            );

            broadcastToOrg(orgId, {
              type: "session.title.update",
              data: { sessionId: session.id, title },
            });
          } catch (err) {
            console.error(
              `[session-titles] Failed for session ${session.id}:`,
              err
            );
          }
        }
      }
    } catch (err) {
      console.error("[session-titles] Failed:", err);
    }
  }

  g.__gc_session_title_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log(
    `[session-titles] Started (interval: ${TITLE_INTERVAL_MINUTES}m, check: 60s)`
  );
}

function formatEventsForPrompt(events: any[], projectName: string): string {
  const lines: string[] = [`Project: ${projectName}`];

  // Events are DESC order from query, reverse for chronological
  for (const event of [...events].reverse()) {
    const payload =
      typeof event.payload === "string"
        ? JSON.parse(event.payload)
        : event.payload;
    const type = event.event_type;

    if (type === "prompt.submit" && payload.promptText) {
      const text =
        payload.promptText.length > 200
          ? payload.promptText.slice(0, 200) + "..."
          : payload.promptText;
      lines.push(`[prompt] ${text}`);
    } else if (type === "tool.start" || type === "tool.complete") {
      const tool = payload.toolName ?? "unknown";
      const file =
        payload.filePath ?? payload.file_path ?? payload.path ?? "";
      lines.push(`[${type}] ${tool}${file ? ` ${file}` : ""}`);
    } else if (type === "agent.start") {
      lines.push(`[agent] ${payload.agentType ?? "agent"} started`);
    } else if (type === "response.complete") {
      lines.push(`[response] completed`);
    }
  }

  return lines.join("\n");
}

function buildPrompt(eventSummary: string): string {
  return `You are generating a short title for a developer coding session. Based on the session activity below, generate a concise title (max 50 characters) that describes the WORK being done.

Rules:
- Use present continuous tense (e.g., "Adding...", "Fixing...", "Refactoring...")
- Focus on the task/work, not the person
- Do NOT include developer names
- Do NOT include project names
- Return ONLY the title text, nothing else
- Max 50 characters

Session activity:
${eventSummary}`;
}
