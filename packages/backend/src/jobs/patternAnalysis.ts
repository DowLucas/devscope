import type { SQL } from "bun";
import { isAiAvailable } from "../ai/gemini";
import { runPatternWorkflow } from "../ai/workflows/patternWorkflow";
import { runAntiPatternWorkflow } from "../ai/workflows/antiPatternWorkflow";
import { runPlaybookWorkflow } from "../ai/workflows/playbookWorkflow";
import { broadcast } from "../ws/handler";

const CHECK_INTERVAL_MS = 60_000;

export function startPatternAnalysis(sql: SQL) {
  const g = globalThis as any;

  if (g.__gc_pattern_analysis_interval) {
    clearInterval(g.__gc_pattern_analysis_interval);
  }

  if (!isAiAvailable()) {
    console.log("[pattern-analysis] Skipped — GEMINI_API_KEY not set");
    return;
  }

  const scheduleHour = Math.min(
    Math.max(Number(process.env.PATTERN_ANALYSIS_SCHEDULE ?? 1), 0),
    23
  );

  let lastRunDate = "";
  let lastPlaybookWeek = "";

  async function check() {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();

    if (todayStr !== lastRunDate && currentHour >= scheduleHour) {
      lastRunDate = todayStr;

      // Daily: pattern analysis + anti-pattern detection
      try {
        console.log("[pattern-analysis] Running daily pattern analysis...");
        const patterns = await runPatternWorkflow(sql, 1);
        console.log(`[pattern-analysis] Discovered ${patterns.length} patterns`);

        for (const pattern of patterns) {
          broadcast({ type: "ai.pattern.new", data: pattern });
        }
      } catch (err) {
        console.error("[pattern-analysis] Pattern workflow failed:", err);
      }

      try {
        console.log("[pattern-analysis] Running anti-pattern detection...");
        const antiPatterns = await runAntiPatternWorkflow(sql, 1);
        console.log(`[pattern-analysis] Detected ${antiPatterns.length} anti-patterns`);

        for (const ap of antiPatterns) {
          broadcast({ type: "ai.antipattern.new", data: ap });
        }
      } catch (err) {
        console.error("[pattern-analysis] Anti-pattern workflow failed:", err);
      }

      // Weekly: playbook generation (Mondays)
      const weekStr = `${now.getFullYear()}-W${Math.ceil((now.getDate() + 6 - dayOfWeek) / 7)}`;
      if (dayOfWeek === 1 && weekStr !== lastPlaybookWeek) {
        lastPlaybookWeek = weekStr;

        try {
          console.log("[pattern-analysis] Running weekly playbook generation...");
          const playbooks = await runPlaybookWorkflow(sql);
          console.log(`[pattern-analysis] Generated ${playbooks.length} playbooks`);

          for (const pb of playbooks) {
            broadcast({ type: "ai.playbook.new", data: pb });
          }
        } catch (err) {
          console.error("[pattern-analysis] Playbook workflow failed:", err);
        }
      }
    }
  }

  g.__gc_pattern_analysis_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log(
    `[pattern-analysis] Scheduled daily at hour ${scheduleHour} (check interval: 60s)`
  );
}
