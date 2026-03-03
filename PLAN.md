# DevScope Upskilling Platform — Implementation Plan

Transform DevScope from an analytics/monitoring tool into an **AI upskilling platform** that turns AI usage data into team skills. Six phases, ordered by dependency.

---

## Phase 0: Enable Daily Insight Job (Quick Win)

**Goal**: Activate the already-coded daily insight scheduler.

### Changes

1. **`packages/backend/src/index.ts`** — Add one import + one call:
   ```ts
   import { startAiInsightGeneration } from "./jobs/aiInsights";
   // After line 30 (startDigestGeneration):
   startAiInsightGeneration(sql);
   ```

**No migration, no new files.** The job, broadcast logic, and cleanup are already implemented in `packages/backend/src/jobs/aiInsights.ts`.

---

## Phase 1: Session Pattern Analysis (Foundation)

**Goal**: Extract tool-call sequences from sessions, cluster them into named patterns via Gemini, and store them for use by all downstream features.

### 1.1 Database Migration

**New file**: `packages/backend/src/db/migrations/007_upskilling_tables.sql`

```sql
-- Patterns discovered from session tool sequences
CREATE TABLE IF NOT EXISTS session_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                          -- e.g. "Read-Edit-Test cycle"
  description TEXT NOT NULL,                   -- AI-generated explanation
  tool_sequence TEXT[] NOT NULL,               -- e.g. {"Read","Edit","Bash"}
  avg_success_rate FLOAT NOT NULL DEFAULT 0,   -- 0-1, based on tool outcomes
  occurrence_count INT NOT NULL DEFAULT 1,     -- how many sessions matched
  effectiveness TEXT NOT NULL DEFAULT 'neutral' CHECK (effectiveness IN ('effective','neutral','ineffective')),
  category TEXT,                               -- e.g. "testing", "refactoring", "debugging"
  data_context JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link table: which sessions exhibited which patterns
CREATE TABLE IF NOT EXISTS session_pattern_matches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  pattern_id TEXT NOT NULL REFERENCES session_patterns(id) ON DELETE CASCADE,
  match_confidence FLOAT NOT NULL DEFAULT 1.0,
  tool_success_rate FLOAT,                     -- this session's rate for this pattern
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_patterns_effectiveness ON session_patterns(effectiveness);
CREATE INDEX IF NOT EXISTS idx_session_patterns_created ON session_patterns(created_at);
CREATE INDEX IF NOT EXISTS idx_session_pattern_matches_session ON session_pattern_matches(session_id);
CREATE INDEX IF NOT EXISTS idx_session_pattern_matches_pattern ON session_pattern_matches(pattern_id);
```

### 1.2 Shared Types

**Edit**: `packages/shared/src/ai.ts` — Add new types:

```ts
export type PatternEffectiveness = "effective" | "neutral" | "ineffective";

export interface SessionPattern {
  id: string;
  name: string;
  description: string;
  tool_sequence: string[];
  avg_success_rate: number;
  occurrence_count: number;
  effectiveness: PatternEffectiveness;
  category: string | null;
  data_context: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SessionPatternMatch {
  id: string;
  session_id: string;
  pattern_id: string;
  match_confidence: number;
  tool_success_rate: number | null;
  created_at: string;
}
```

### 1.3 New Query Functions

**New file**: `packages/backend/src/db/patternQueries.ts`

Functions:
- `getSessionToolSequence(sql, sessionId)` — Extract ordered `[{toolName, success, eventType}]` from events table for a session, ordered by `created_at`
- `getRecentSessionSequences(sql, days, limit)` — Get tool sequences for recently ended sessions (batch for pattern analysis)
- `upsertPattern(sql, pattern)` — Insert or update a pattern (merge by matching tool_sequence)
- `createPatternMatch(sql, sessionId, patternId, confidence, successRate)` — Link a session to a pattern
- `getPatterns(sql, opts?)` — List patterns with optional filters (effectiveness, category, limit)
- `getPatternStats(sql, days)` — Aggregate stats: pattern counts, avg success rates, trending patterns
- `getSessionPatterns(sql, sessionId)` — Get patterns for a specific session
- `getDeveloperPatternProfile(sql, developerId, days)` — Patterns used by a specific developer (for Phase 4)

Export from `packages/backend/src/db/index.ts`.

### 1.4 Pattern Analysis Workflow

**New file**: `packages/backend/src/ai/workflows/patternWorkflow.ts`

LangGraph StateGraph: `START → extractSequences → clusterPatterns → persistPatterns → END`

Nodes:
1. **extractSequences**: Call `getRecentSessionSequences(sql, 1, 200)` to get yesterday's ended sessions with their tool sequences. Filter to sessions with 3+ tool events.

2. **clusterPatterns**: Send sequences to Gemini with prompt:
   ```
   You are analyzing Claude Code developer sessions to discover workflow patterns.
   Each session is a sequence of tool calls with success/failure outcomes.

   Identify recurring patterns — named workflow strategies that developers use.
   For each pattern:
   - name: short descriptive name (e.g. "Read-before-Edit", "Test-driven loop", "Grep-then-Read exploration")
   - description: 1-2 sentences explaining the workflow
   - tool_sequence: canonical ordered tool names (e.g. ["Read", "Edit", "Bash"])
   - effectiveness: "effective" if sessions using it have high success rates,
     "ineffective" if low, "neutral" otherwise
   - category: one of "testing", "refactoring", "debugging", "exploration", "writing", "other"

   Focus on patterns that appear in 2+ sessions. Merge similar patterns.
   Return JSON array. Return empty array if no meaningful patterns found.
   ```

3. **persistPatterns**: Upsert patterns into `session_patterns`, create `session_pattern_matches` linking sessions to their discovered patterns.

### 1.5 Pattern Analysis Scheduler

**New file**: `packages/backend/src/jobs/patternAnalysis.ts`

- `startPatternAnalysis(sql)` — Daily job (similar structure to `aiInsights.ts`)
- Runs after insight generation (schedule at hour 1 by default, configurable via `PATTERN_ANALYSIS_SCHEDULE`)
- Calls `runPatternWorkflow(sql)`
- Broadcasts `ai.pattern.new` WebSocket events for new patterns

Wire into `packages/backend/src/index.ts`: `startPatternAnalysis(sql);`

### 1.6 New Gemini Tool

**Edit**: `packages/backend/src/ai/tools.ts` — Add new tool:

```ts
{
  name: "getSessionPatterns",
  description: "Get discovered workflow patterns with effectiveness ratings and occurrence counts",
  parameters: { days: { type: "number", description: "Lookback days (default 30)" } }
}
```

This makes pattern data available to the chat workflow and other AI features.

### 1.7 API Route

**New file**: `packages/backend/src/routes/patterns.ts`

- `GET /api/patterns` — List patterns (query: `?effectiveness=effective&category=testing&limit=20`)
- `GET /api/patterns/:id` — Pattern detail with matched sessions
- `GET /api/patterns/stats` — Aggregate pattern statistics
- `POST /api/patterns/analyze` — Trigger manual pattern analysis (rate-limited)

Register in `index.ts`: `app.route("/api/patterns", patternsRoutes(sql));`
Add org scope middleware: `app.use("/api/patterns/*", orgScopeMiddleware(sql));`

---

## Phase 2: Anti-Pattern Detection

**Goal**: Detect common AI usage pitfalls (retry loops, failure cascades, abandoned sessions) using rule-based checks + AI classification.

### 2.1 Database Migration

**Extend** `007_upskilling_tables.sql` (same migration file):

```sql
-- Anti-patterns detected in sessions
CREATE TABLE IF NOT EXISTS anti_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                       -- e.g. "Retry Loop", "Failure Cascade"
  description TEXT NOT NULL,
  detection_rule TEXT NOT NULL,             -- "retry_loop" | "failure_cascade" | "abandoned_session" | "ai_detected"
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  suggestion TEXT NOT NULL,                 -- how to avoid this anti-pattern
  occurrence_count INT NOT NULL DEFAULT 1,
  data_context JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link: which sessions exhibited which anti-patterns
CREATE TABLE IF NOT EXISTS session_anti_pattern_matches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  anti_pattern_id TEXT NOT NULL REFERENCES anti_patterns(id) ON DELETE CASCADE,
  details JSONB NOT NULL DEFAULT '{}',       -- specifics: which tools, at what point, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anti_patterns_severity ON anti_patterns(severity);
CREATE INDEX IF NOT EXISTS idx_anti_patterns_rule ON anti_patterns(detection_rule);
CREATE INDEX IF NOT EXISTS idx_anti_patterns_created ON anti_patterns(created_at);
CREATE INDEX IF NOT EXISTS idx_session_anti_pattern_matches_session ON session_anti_pattern_matches(session_id);
CREATE INDEX IF NOT EXISTS idx_session_anti_pattern_matches_pattern ON session_anti_pattern_matches(anti_pattern_id);
```

### 2.2 Shared Types

**Edit**: `packages/shared/src/ai.ts` — Add:

```ts
export type AntiPatternRule = "retry_loop" | "failure_cascade" | "abandoned_session" | "ai_detected";
export type AntiPatternSeverity = "info" | "warning" | "critical";

export interface AntiPattern {
  id: string;
  name: string;
  description: string;
  detection_rule: AntiPatternRule;
  severity: AntiPatternSeverity;
  suggestion: string;
  occurrence_count: number;
  data_context: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SessionAntiPatternMatch {
  id: string;
  session_id: string;
  anti_pattern_id: string;
  details: Record<string, unknown>;
  created_at: string;
}
```

### 2.3 Rule-Based Detection Functions

**New file**: `packages/backend/src/ai/detection/antiPatternRules.ts`

Pure functions that analyze a session's tool sequence and return detected anti-patterns:

1. **`detectRetryLoops(sequence)`** — Same tool called 3+ times consecutively with failures.
   ```ts
   // Returns: { rule: "retry_loop", tool: string, consecutiveFailures: number, startIndex: number }[]
   ```

2. **`detectFailureCascades(sequence)`** — A tool failure followed by 3+ more failures (any tool) within the same session.
   ```ts
   // Returns: { rule: "failure_cascade", triggerTool: string, cascadeLength: number, tools: string[] }[]
   ```

3. **`detectAbandonedSessions(sequence, sessionEnded)`** — Session ended with >50% failure rate in last 10 tool calls.
   ```ts
   // Returns: { rule: "abandoned_session", failureRate: number, lastTools: string[] } | null
   ```

### 2.4 Anti-Pattern Workflow

**New file**: `packages/backend/src/ai/workflows/antiPatternWorkflow.ts`

LangGraph StateGraph: `START → fetchSessions → detectRuleBased → classifyWithAi → persist → END`

Nodes:
1. **fetchSessions**: Get sessions ended in last 24h with their tool sequences (reuse `getRecentSessionSequences`)
2. **detectRuleBased**: Run the 3 rule-based detectors against each session's sequence
3. **classifyWithAi**: Send sessions with rule-based hits + borderline sessions to Gemini for classification and suggestion generation:
   ```
   These sessions show potential anti-patterns. For each:
   - Confirm or reject the detection
   - Rate severity (info/warning/critical)
   - Provide a concrete suggestion for how the developer could improve
   Focus on tool usage patterns, not developer behavior.
   ```
4. **persist**: Upsert anti-patterns, create session matches, broadcast via WebSocket

### 2.5 Anti-Pattern Scheduler

**Edit**: `packages/backend/src/jobs/patternAnalysis.ts` — Extend to also run anti-pattern detection after pattern analysis:

```ts
// In the daily check function, after pattern analysis:
const antiPatterns = await runAntiPatternWorkflow(sql);
for (const ap of antiPatterns) {
  broadcast({ type: "ai.antipattern.new", data: ap });
}
```

### 2.6 Query Functions

**New file**: `packages/backend/src/db/antiPatternQueries.ts`

- `upsertAntiPattern(sql, antiPattern)` — Insert or update anti-pattern
- `createAntiPatternMatch(sql, sessionId, antiPatternId, details)` — Link session to anti-pattern
- `getAntiPatterns(sql, opts?)` — List anti-patterns with filters (severity, rule)
- `getAntiPatternStats(sql, days)` — Aggregate: counts by type, trending anti-patterns
- `getSessionAntiPatterns(sql, sessionId)` — Anti-patterns for a session
- `getDeveloperAntiPatterns(sql, developerId, days)` — Anti-patterns for a developer (Phase 4)
- `getAntiPatternTrends(sql, days)` — Daily counts for trend analysis

Export from `packages/backend/src/db/index.ts`.

### 2.7 New Gemini Tool

**Edit**: `packages/backend/src/ai/tools.ts` — Add:

```ts
{
  name: "getAntiPatterns",
  description: "Get detected anti-patterns (retry loops, failure cascades, etc.) with severity and suggestions",
  parameters: { days: { type: "number" }, severity: { type: "string", enum: ["info","warning","critical"] } }
}
```

### 2.8 API Routes

**Extend** `packages/backend/src/routes/patterns.ts`:

- `GET /api/patterns/anti` — List anti-patterns
- `GET /api/patterns/anti/:id` — Anti-pattern detail with matched sessions
- `GET /api/patterns/anti/stats` — Anti-pattern aggregate stats
- `GET /api/patterns/anti/trends` — Daily anti-pattern trend data

---

## Phase 3: AI Coaching in Reports

**Goal**: Enhance the report workflow to include pattern-based coaching: top effective patterns, most common anti-patterns, and concrete suggestions.

### 3.1 Changes to `reportWorkflow.ts`

**Edit**: `packages/backend/src/ai/workflows/reportWorkflow.ts`

1. In `gatherReportData()`, add two more parallel queries:
   ```ts
   const [/* existing queries */, patterns, antiPatterns] = await Promise.all([
     /* existing */,
     getPatterns(sql, { effectiveness: 'effective', limit: 10 }),
     getAntiPatternStats(sql, days),
   ]);
   ```

2. Add to the returned `data` object:
   ```ts
   effectivePatterns: patterns,
   antiPatternSummary: antiPatterns,
   ```

3. In `generateOutline()` and `writeReport()`, enhance the prompts:

   Add to the outline prompt:
   ```
   Include a "Skills & Patterns" section covering:
   - Top effective workflow patterns the team is using well
   - Most common anti-patterns and how to avoid them
   - Concrete coaching suggestions (e.g. "Sessions that used Read before Edit had 40% fewer failures")
   ```

   Add to the write prompt's Requirements:
   ```
   - Include a "Skills & Patterns" section after Tool Performance:
     - Highlight top 3 effective patterns with success rates
     - Flag top 3 anti-patterns with frequency and avoidance tips
     - Provide 2-3 concrete coaching suggestions based on the data
   ```

### 3.2 Changes to `insightWorkflow.ts`

**Edit**: `packages/backend/src/ai/workflows/insightWorkflow.ts`

1. In `gatherData()`, add pattern data:
   ```ts
   const [/* existing */, patternStats, antiPatternTrends] = await Promise.all([
     /* existing */,
     getPatternStats(sql, days),
     getAntiPatternTrends(sql, days),
   ]);
   ```

2. Enhance the `INSIGHT_PROMPT` to include:
   ```
   5. Pattern Health: are effective patterns being adopted more? Are anti-patterns declining?
   6. Coaching Opportunities: specific suggestions based on pattern/anti-pattern data
   ```

3. Add `"coaching"` as a new insight type (update `ai_insights` CHECK constraint via migration, and update shared types).

### 3.3 Type Updates

**Edit**: `packages/shared/src/ai.ts`:
```ts
export type InsightType = "anomaly" | "trend" | "comparison" | "recommendation" | "coaching";
```

**Edit** migration `007_upskilling_tables.sql`:
```sql
ALTER TABLE ai_insights DROP CONSTRAINT IF EXISTS ai_insights_type_check;
ALTER TABLE ai_insights ADD CONSTRAINT ai_insights_type_check
  CHECK (type IN ('anomaly', 'trend', 'comparison', 'recommendation', 'coaching'));
```

---

## Phase 4: Personal Skill Dashboard

**Goal**: A self-view dashboard showing a developer's own skill progression over time.

### 4.1 New Query Functions

**Edit**: `packages/backend/src/db/patternQueries.ts` — Add:

- `getDeveloperToolMastery(sql, developerId, weeks)` — Weekly success rate per tool:
  ```sql
  SELECT
    date_trunc('week', e.created_at) as week,
    e.payload->>'toolName' as tool_name,
    SUM(CASE WHEN e.event_type = 'tool.complete' THEN 1 ELSE 0 END)::INT as successes,
    COUNT(*)::INT as total,
    ROUND(SUM(CASE WHEN e.event_type = 'tool.complete' THEN 1 ELSE 0 END)::FLOAT / GREATEST(COUNT(*), 1), 3)::FLOAT as success_rate
  FROM events e
  JOIN sessions s ON e.session_id = s.id
  WHERE s.developer_id = $developerId
    AND e.event_type IN ('tool.complete', 'tool.fail')
    AND e.created_at >= NOW() - make_interval(weeks => $weeks)
  GROUP BY week, tool_name
  ORDER BY week ASC, total DESC
  ```

- `getDeveloperPatternAdoption(sql, developerId, weeks)` — Weekly count of effective vs ineffective patterns used
- `getDeveloperAntiPatternTrend(sql, developerId, weeks)` — Weekly anti-pattern frequency
- `getDeveloperSessionQuality(sql, developerId, weeks)` — Weekly composite: avg tool success rate, avg session duration, sessions completed

### 4.2 API Routes

**New file**: `packages/backend/src/routes/skills.ts`

All routes are developer-self-view only (use session.user to resolve developer ID):

- `GET /api/skills/mastery?weeks=12` — Tool mastery curves
- `GET /api/skills/patterns?weeks=12` — Pattern adoption trends
- `GET /api/skills/anti-patterns?weeks=12` — Anti-pattern frequency trends
- `GET /api/skills/quality?weeks=12` — Session quality score trend
- `GET /api/skills/summary` — Overall skill summary (current mastery level, trend direction, top patterns, top anti-patterns)

Register in `index.ts`: `app.route("/api/skills", skillsRoutes(sql));`
Auth: `requireSession` (already applied by the wildcard middleware).

Developer ID resolution: Look up `developers` table by matching `email` from session user, or via `organization_developer` linkage.

### 4.3 Dashboard Components

**New directory**: `packages/dashboard/src/components/skills/`

- `SkillsView.tsx` — Main page component (tab container)
- `ToolMasteryChart.tsx` — Line chart showing success rate per tool over weeks (Recharts)
- `PatternAdoptionChart.tsx` — Stacked area chart: effective vs ineffective patterns over time
- `AntiPatternTrendChart.tsx` — Bar chart of anti-pattern frequency declining over time
- `SessionQualityChart.tsx` — Composite quality score line chart
- `SkillSummaryCards.tsx` — Top-level cards: "Tool Mastery: 87%", "Anti-patterns this week: 2 (↓40%)"

### 4.4 Zustand Store

**New file**: `packages/dashboard/src/stores/skillStore.ts`

State: `{ mastery, patterns, antiPatterns, quality, summary, loading, error }`
Actions: `fetchMastery(weeks)`, `fetchPatterns(weeks)`, `fetchAntiPatterns(weeks)`, `fetchQuality(weeks)`, `fetchSummary()`

### 4.5 Hook

**New file**: `packages/dashboard/src/hooks/useSkills.ts` — Wraps store actions with loading states.

### 4.6 Route

**Edit**: `packages/dashboard/src/App.tsx` — Add route:
```tsx
import { SkillsView } from "@/components/skills/SkillsView";
// In AppContent Switch:
<Route path="/dashboard/skills/*?" component={SkillsView} />
```

**Edit**: `packages/dashboard/src/components/Layout.tsx` — Add navigation item for "Skills" with `TrendingUp` icon.

---

## Phase 5: Team Playbooks

**Goal**: Shareable, named workflow patterns that the team can reference and adopt.

### 5.1 Database Migration

**Extend** `007_upskilling_tables.sql`:

```sql
CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  tool_sequence TEXT[] NOT NULL,
  when_to_use TEXT NOT NULL,               -- AI-generated guidance
  success_metrics JSONB NOT NULL DEFAULT '{}', -- { avg_success_rate, sessions_using, etc. }
  source_pattern_id TEXT REFERENCES session_patterns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  created_by TEXT,                          -- 'auto' or user ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playbooks_status ON playbooks(status);
CREATE INDEX IF NOT EXISTS idx_playbooks_created ON playbooks(created_at);
```

### 5.2 Shared Types

**Edit**: `packages/shared/src/ai.ts`:

```ts
export type PlaybookStatus = "active" | "draft" | "archived";

export interface Playbook {
  id: string;
  name: string;
  description: string;
  tool_sequence: string[];
  when_to_use: string;
  success_metrics: Record<string, unknown>;
  source_pattern_id: string | null;
  status: PlaybookStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

### 5.3 Playbook Generation

**New file**: `packages/backend/src/ai/workflows/playbookWorkflow.ts`

LangGraph: `START → gatherTopPatterns → generatePlaybooks → persist → END`

1. **gatherTopPatterns**: Query `session_patterns` for effective patterns with occurrence_count >= 3
2. **generatePlaybooks**: Send to Gemini:
   ```
   Convert these effective workflow patterns into team playbooks.
   For each, generate:
   - name: action-oriented name (e.g. "The TDD Loop", "Safe Refactor Workflow")
   - description: 2-3 sentence explanation
   - when_to_use: specific scenario guidance
   - success_metrics: { avg_success_rate, typical_session_count }
   Only create playbooks for patterns that are clearly useful and replicable.
   ```
3. **persist**: Insert into `playbooks` table with `created_by: 'auto'`

### 5.4 Weekly Playbook Refresh

**Edit**: `packages/backend/src/jobs/patternAnalysis.ts` — Add weekly playbook regeneration:
- Every Monday, run `runPlaybookWorkflow(sql)` after pattern analysis
- Archive playbooks whose source patterns dropped below effectiveness threshold

### 5.5 Query Functions

**New file**: `packages/backend/src/db/playbookQueries.ts`

- `getPlaybooks(sql, opts?)` — List active playbooks
- `getPlaybook(sql, id)` — Single playbook with linked pattern data
- `createPlaybook(sql, data)` — Manual creation
- `updatePlaybook(sql, id, data)` — Edit (for team lead curation)
- `archivePlaybook(sql, id)` — Soft delete
- `getPlaybookAdoption(sql, playbookId, days)` — How many sessions used this pattern recently

### 5.6 API Routes

**New file**: `packages/backend/src/routes/playbooks.ts`

- `GET /api/playbooks` — List active playbooks
- `GET /api/playbooks/:id` — Playbook detail with adoption metrics
- `POST /api/playbooks` — Manual creation (admin/team-lead)
- `PUT /api/playbooks/:id` — Edit playbook
- `DELETE /api/playbooks/:id` — Archive playbook
- `POST /api/playbooks/generate` — Trigger playbook generation (rate-limited)

Register in `index.ts` with org scope middleware.

### 5.7 Dashboard Components

**New directory**: `packages/dashboard/src/components/playbooks/`

- `PlaybooksView.tsx` — Main page: grid of playbook cards
- `PlaybookCard.tsx` — Card showing name, tool sequence visualization, success rate, adoption count
- `PlaybookDetail.tsx` — Full playbook view with description, when-to-use, metrics, adoption chart
- `ToolSequenceViz.tsx` — Reusable component: visual pipe of tool icons (e.g. `Read → Edit → Bash`)

### 5.8 Route

**Edit**: `packages/dashboard/src/App.tsx`:
```tsx
import { PlaybooksView } from "@/components/playbooks/PlaybooksView";
<Route path="/dashboard/playbooks/*?" component={PlaybooksView} />
```

**Edit**: `packages/dashboard/src/components/Layout.tsx` — Add "Playbooks" nav item with `BookOpen` icon.

---

## Cross-Cutting Concerns

### WebSocket Events

Add to `packages/shared/src/ai.ts`:
```ts
export type AiWsMessageType =
  | "ai.insight.new"
  | "ai.report.completed"
  | "ai.pattern.new"
  | "ai.antipattern.new"
  | "ai.playbook.new";
```

### Privacy

- **Patterns & anti-patterns**: Team-level aggregate data in shared views. Pattern names, descriptions, and statistics are visible to all team members.
- **Personal skill data**: Only visible to the developer themselves via the Skills page (self-view). The API resolves developer ID from the authenticated session — no developer ID parameter exposed.
- **Playbooks**: Fully shared — these are team resources by design.

### Token Budget

All new workflows use Gemini tokens. Consider:
- Pattern analysis: ~2-4k tokens/run (once daily)
- Anti-pattern detection: ~2-4k tokens/run (once daily)
- Playbook generation: ~2-3k tokens/run (once weekly)
- Enhanced reports: +~1k tokens/report (marginal increase)

Total daily increase: ~5-9k tokens — well within the default 1M daily budget.

### Migration Strategy

All schema changes in a single migration file (`007_upskilling_tables.sql`) to keep it atomic. The `ALTER TABLE ai_insights` for the new "coaching" type goes in the same migration.

---

## File Summary

### New Files (13)
| File | Purpose |
|------|---------|
| `packages/backend/src/db/migrations/007_upskilling_tables.sql` | Schema for patterns, anti-patterns, playbooks |
| `packages/backend/src/db/patternQueries.ts` | Pattern + skill DB queries |
| `packages/backend/src/db/antiPatternQueries.ts` | Anti-pattern DB queries |
| `packages/backend/src/db/playbookQueries.ts` | Playbook DB queries |
| `packages/backend/src/ai/detection/antiPatternRules.ts` | Rule-based anti-pattern detectors |
| `packages/backend/src/ai/workflows/patternWorkflow.ts` | Session pattern analysis workflow |
| `packages/backend/src/ai/workflows/antiPatternWorkflow.ts` | Anti-pattern detection workflow |
| `packages/backend/src/ai/workflows/playbookWorkflow.ts` | Playbook generation workflow |
| `packages/backend/src/jobs/patternAnalysis.ts` | Daily/weekly scheduler for patterns + anti-patterns + playbooks |
| `packages/backend/src/routes/patterns.ts` | Pattern + anti-pattern API routes |
| `packages/backend/src/routes/skills.ts` | Personal skill dashboard API routes |
| `packages/backend/src/routes/playbooks.ts` | Playbook API routes |
| `packages/dashboard/src/stores/skillStore.ts` | Skill dashboard Zustand store |

### Modified Files (10)
| File | Change |
|------|--------|
| `packages/backend/src/index.ts` | Enable insight job, register new routes |
| `packages/shared/src/ai.ts` | Add pattern, anti-pattern, playbook, skill types |
| `packages/backend/src/db/index.ts` | Export new query modules |
| `packages/backend/src/ai/tools.ts` | Add pattern + anti-pattern Gemini tools |
| `packages/backend/src/ai/workflows/reportWorkflow.ts` | Add coaching section to reports |
| `packages/backend/src/ai/workflows/insightWorkflow.ts` | Add pattern/anti-pattern data + coaching insight type |
| `packages/dashboard/src/App.tsx` | Add /skills and /playbooks routes |
| `packages/dashboard/src/components/Layout.tsx` | Add Skills and Playbooks nav items |

### New Dashboard Components (10+)
| Directory | Components |
|-----------|------------|
| `components/skills/` | SkillsView, ToolMasteryChart, PatternAdoptionChart, AntiPatternTrendChart, SessionQualityChart, SkillSummaryCards |
| `components/playbooks/` | PlaybooksView, PlaybookCard, PlaybookDetail, ToolSequenceViz |
