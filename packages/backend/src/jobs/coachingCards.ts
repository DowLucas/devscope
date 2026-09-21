import type { SQL } from "bun";
import { isAiAvailable } from "../ai/gemini";
import { generateCoachingCard } from "../ai/workflows/coachingCardWorkflow";
import { getOrgDeveloperIds } from "../services/developerLink";

const CHECK_INTERVAL_MS = 60_000;
// Day-of-week (0=Sun..6=Sat) and hour to run at. Configurable via env.
const RUN_DOW = Math.min(Math.max(Number(process.env.COACHING_CARD_DOW ?? 1), 0), 6);
const RUN_HOUR = Math.min(Math.max(Number(process.env.COACHING_CARD_HOUR ?? 6), 0), 23);

function weekStartOf(d: Date): string {
  // Monday-based week
  const day = d.getDay();
  const offset = (day + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(d);
  monday.setDate(d.getDate() - offset);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

async function runForOrg(sql: SQL, orgId: string, weekStart: string): Promise<void> {
  const devIds = await getOrgDeveloperIds(sql, orgId);
  if (devIds.length === 0) return;

  let generated = 0;
  let skipped = 0;

  for (const devId of devIds) {
    // Skip if already generated for this week
    const [existing] = (await sql`
      SELECT id FROM coaching_cards
      WHERE developer_id = ${devId} AND week_start = ${weekStart}::DATE
      LIMIT 1`) as any[];
    if (existing) {
      skipped++;
      continue;
    }

    try {
      const result = await generateCoachingCard(sql, devId);
      if (result.recommendations.length === 0) {
        skipped++;
        continue;
      }

      const id = crypto.randomUUID();
      await sql`
        INSERT INTO coaching_cards (id, developer_id, organization_id, week_start, recommendations)
        VALUES (
          ${id},
          ${devId},
          ${orgId},
          ${weekStart}::DATE,
          ${JSON.stringify(result.recommendations)}::JSONB
        )
        ON CONFLICT (developer_id, week_start) DO NOTHING`;
      generated++;
    } catch (err) {
      console.error(`[coaching-cards] Failed for dev ${devId}:`, err);
    }
  }

  console.log(
    `[coaching-cards] org=${orgId} week=${weekStart} generated=${generated} skipped=${skipped}`,
  );
}

export function startCoachingCardGeneration(sql: SQL) {
  const g = globalThis as any;
  if (g.__gc_coaching_card_interval) clearInterval(g.__gc_coaching_card_interval);

  if (!isAiAvailable()) {
    console.log("[coaching-cards] Skipped — GEMINI_API_KEY not set");
    return;
  }

  let lastRunWeek = "";

  async function check() {
    const now = new Date();
    const weekStart = weekStartOf(now);
    if (weekStart === lastRunWeek) return;
    if (now.getDay() !== RUN_DOW) return;
    if (now.getHours() < RUN_HOUR) return;

    lastRunWeek = weekStart;
    try {
      const orgs = (await sql`SELECT id FROM organization`) as any[];
      for (const org of orgs) {
        await runForOrg(sql, org.id, weekStart);
      }
    } catch (err) {
      console.error("[coaching-cards] Failed:", err);
    }
  }

  g.__gc_coaching_card_interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log(`[coaching-cards] Scheduled weekly (DOW=${RUN_DOW} hour=${RUN_HOUR})`);
}
