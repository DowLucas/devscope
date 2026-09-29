import type { SQL } from "bun";
import { isAiAvailable } from "../ai/gemini";
import { runPatternWorkflow } from "../ai/workflows/patternWorkflow";
import { runAntiPatternWorkflow } from "../ai/workflows/antiPatternWorkflow";
import { runHallucinatedSuccessDetection } from "../ai/workflows/hallucinatedSuccessWorkflow";
import { runPlaybookWorkflow } from "../ai/workflows/playbookWorkflow";
import { runSkillGenerationWorkflow } from "../ai/workflows/skillGenerationWorkflow";
import { runSkillRefinementWorkflow } from "../ai/workflows/skillRefinementWorkflow";
import { withoutContext } from "../db/utils";
import { getTeamSkills } from "../db/teamSkillQueries";
import { broadcastToOrg } from "../ws/handler";

const CHECK_INTERVAL_MS = 60_000;

/** Orgs that have developers; pattern analysis runs once per org, never across orgs. */
async function listOrgIds(sql: SQL): Promise<string[]> {
  const orgs = await sql`
    SELECT DISTINCT organization_id FROM organization_developer
    WHERE organization_id IS NOT NULL`;
  return (orgs as any[]).map((o) => o.organization_id as string);
}

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
        const orgIds = await listOrgIds(sql);

        for (const orgId of orgIds) {
          try {
            // 1. Pattern analysis
            console.log(`[pattern-analysis] Running daily pattern analysis for org ${orgId}...`);
            const patterns = await runPatternWorkflow(sql, orgId, 1);
            console.log(`[pattern-analysis] Discovered/updated ${patterns.length} patterns for org ${orgId}`);

            for (const pattern of patterns) {
              broadcastToOrg(orgId, { type: "ai.pattern.new", data: withoutContext(pattern) });
            }

            // 2. Anti-pattern detection
            console.log(`[pattern-analysis] Running daily anti-pattern detection for org ${orgId}...`);
            const antiPatterns = await runAntiPatternWorkflow(sql, orgId, 1);
            console.log(`[pattern-analysis] Detected ${antiPatterns.length} anti-patterns for org ${orgId}`);

            for (const ap of antiPatterns) {
              broadcastToOrg(orgId, { type: "ai.antipattern.new", data: withoutContext(ap) });
            }

            // 2b. Hallucinated-success audit (rule-based, no LLM)
            try {
              const hallucinated = await runHallucinatedSuccessDetection(sql, orgId, 1);
              if (hallucinated > 0) {
                console.log(`[pattern-analysis] Flagged ${hallucinated} hallucinated-success sessions for org ${orgId}`);
              }
            } catch (err) {
              console.error(`[pattern-analysis] Hallucinated-success detection failed for org ${orgId}:`, err);
            }
          } catch (err) {
            console.error(`[pattern-analysis] Daily analysis failed for org ${orgId}:`, err);
          }
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
          for (const orgId of await listOrgIds(sql)) {
            try {
              const playbooks = await runPlaybookWorkflow(sql, orgId);
              console.log(`[pattern-analysis] Generated ${playbooks.length} playbooks for org ${orgId}`);

              for (const pb of playbooks) {
                broadcastToOrg(orgId, { type: "ai.playbook.new", data: pb });
              }
            } catch (err) {
              console.error(`[pattern-analysis] Playbook generation failed for org ${orgId}:`, err);
            }
          }
        } catch (err) {
          console.error("[pattern-analysis] Playbook generation failed:", err);
        }

        // 4. Weekly team skill generation + refinement
        try {
          console.log("[pattern-analysis] Running weekly team skill generation...");

          for (const orgId of await listOrgIds(sql)) {
            try {
              // Generate new skills
              const skills = await runSkillGenerationWorkflow(sql, orgId);
              console.log(`[pattern-analysis] Generated ${skills.length} skills for org ${orgId}`);

              for (const skill of skills) {
                broadcastToOrg(orgId, { type: "ai.skill.new", data: skill });
              }

              // Refine existing active/approved skills
              const existingSkills = await getTeamSkills(sql, orgId, { status: "active" });
              const approvedSkills = await getTeamSkills(sql, orgId, { status: "approved" });
              const toRefine = [...existingSkills, ...approvedSkills];

              for (const skill of toRefine) {
                try {
                  const refined = await runSkillRefinementWorkflow(sql, skill.id, orgId);
                  if (refined && refined.id !== skill.id) {
                    broadcastToOrg(orgId, { type: "ai.skill.updated", data: refined });
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
