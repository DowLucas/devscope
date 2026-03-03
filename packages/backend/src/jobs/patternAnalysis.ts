import type { SQL } from "bun";
import { isAiAvailable } from "../ai/gemini";
import { runPatternWorkflow } from "../ai/workflows/patternWorkflow";
import { runAntiPatternWorkflow } from "../ai/workflows/antiPatternWorkflow";
import { runPlaybookWorkflow } from "../ai/workflows/playbookWorkflow";
import { runSkillGenerationWorkflow } from "../ai/workflows/skillGenerationWorkflow";
import { runSkillRefinementWorkflow } from "../ai/workflows/skillRefinementWorkflow";
import { getTeamSkills } from "../db/teamSkillQueries";
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

  // Pattern + anti-pattern analysis runs daily at this hour (default: 1 AM)
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
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon

    // Daily pattern + anti-pattern analysis
    if (todayStr !== lastRunDate && currentHour >= scheduleHour) {
      lastRunDate = todayStr;

      try {
        // 1. Pattern analysis
        console.log("[pattern-analysis] Running daily pattern analysis...");
        const patterns = await runPatternWorkflow(sql, 1);
        console.log(`[pattern-analysis] Discovered/updated ${patterns.length} patterns`);

        for (const pattern of patterns) {
          broadcast({ type: "ai.pattern.new", data: pattern });
        }

        // 2. Anti-pattern detection
        console.log("[pattern-analysis] Running daily anti-pattern detection...");
        const antiPatterns = await runAntiPatternWorkflow(sql, 1);
        console.log(`[pattern-analysis] Detected ${antiPatterns.length} anti-patterns`);

        for (const ap of antiPatterns) {
          broadcast({ type: "ai.antipattern.new", data: ap });
        }
      } catch (err) {
        console.error("[pattern-analysis] Daily analysis failed:", err);
      }

      // 3. Weekly playbook refresh (Mondays)
      // Proper ISO week number calculation
      const jan4 = new Date(now.getFullYear(), 0, 4);
      const startOfWeek = new Date(jan4.getTime() - ((jan4.getDay() || 7) - 1) * 86400000);
      const isoWeekNum = Math.ceil(((now.getTime() - startOfWeek.getTime()) / 86400000 + 1) / 7);
      const weekStr = `${now.getFullYear()}-W${isoWeekNum}`;
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
          console.error("[pattern-analysis] Playbook generation failed:", err);
        }

        // 4. Weekly team skill generation + refinement
        try {
          console.log("[pattern-analysis] Running weekly team skill generation...");

          // Get all organization IDs that have developers
          const orgs = await sql`
            SELECT DISTINCT organization_id FROM organization_developer
            WHERE organization_id IS NOT NULL`;

          for (const org of orgs) {
            const orgId = (org as any).organization_id;
            try {
              // Generate new skills
              const skills = await runSkillGenerationWorkflow(sql, orgId);
              console.log(`[pattern-analysis] Generated ${skills.length} skills for org ${orgId}`);

              for (const skill of skills) {
                broadcast({ type: "ai.skill.new", data: skill });
              }

              // Refine existing active/approved skills
              const existingSkills = await getTeamSkills(sql, orgId, { status: "active" });
              const approvedSkills = await getTeamSkills(sql, orgId, { status: "approved" });
              const toRefine = [...existingSkills, ...approvedSkills];

              for (const skill of toRefine) {
                try {
                  const refined = await runSkillRefinementWorkflow(sql, skill.id, orgId);
                  if (refined && refined.id !== skill.id) {
                    broadcast({ type: "ai.skill.updated", data: refined });
                  }
                } catch (err) {
                  console.error(`[pattern-analysis] Skill refinement failed for ${skill.id}:`, err);
                }
              }
            } catch (err) {
              console.error(`[pattern-analysis] Skill generation failed for org ${orgId}:`, err);
            }
          }
        } catch (err) {
          console.error("[pattern-analysis] Team skill generation failed:", err);
        }
      }
    }
  }

  g.__gc_pattern_analysis_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log(
    `[pattern-analysis] Scheduled daily at hour ${scheduleHour} (patterns + anti-patterns), weekly playbooks + skills on Mondays`
  );
}
