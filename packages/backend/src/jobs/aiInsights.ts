import type { SQL } from "bun";
import { isAiAvailable } from "../ai/gemini";
import { runInsightWorkflow } from "../ai/workflows/insightWorkflow";
import { cleanupExpiredInsights } from "../db";
import { broadcast } from "../ws/handler";

const CHECK_INTERVAL_MS = 60_000; // Check every minute

export function startAiInsightGeneration(sql: SQL) {
  const g = globalThis as any;

  if (g.__gc_ai_insight_interval) {
    clearInterval(g.__gc_ai_insight_interval);
  }

  if (!isAiAvailable()) {
    console.log("[ai-insights] Skipped — GEMINI_API_KEY not set");
    return;
  }

  // Default: midnight (hour 0). Configurable via AI_INSIGHT_SCHEDULE (hour 0-23).
  const scheduleHour = Math.min(
    Math.max(Number(process.env.AI_INSIGHT_SCHEDULE ?? 0), 0),
    23
  );

  let lastRunDate = "";

  async function check() {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const currentHour = now.getHours();

    // Run once per day at the scheduled hour
    if (todayStr !== lastRunDate && currentHour >= scheduleHour) {
      lastRunDate = todayStr;

      try {
        console.log("[ai-insights] Running daily insight generation...");
        const insights = await runInsightWorkflow(sql, 1);
        console.log(
          `[ai-insights] Generated ${insights.length} insights`
        );

        // Broadcast new insights
        for (const insight of insights) {
          broadcast({ type: "ai.insight.new" , data: insight });
        }

        // Cleanup expired insights
        const cleaned = await cleanupExpiredInsights(sql);
        if (cleaned > 0) {
          console.log(`[ai-insights] Cleaned up ${cleaned} expired insights`);
        }
      } catch (err) {
        console.error("[ai-insights] Failed:", err);
      }
    }
  }

  g.__gc_ai_insight_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log(
    `[ai-insights] Scheduled daily at hour ${scheduleHour} (check interval: 60s)`
  );
}
