# Ethics Refactor Plan

A concrete implementation plan to transform DevScope from an individual surveillance tool into a team empowerment platform.

---

## Guiding Principle

**Show teams how they work together. Never show managers how individuals perform.**

Every feature should pass this test: "Would a developer feel comfortable knowing this exists?" If not, remove it or make it self-service only.

---

## Phase 1: Remove Surveillance Features

### 1.1 Remove Burnout Risk Scoring

**Why:** Algorithmic burnout detection based on timestamps is pseudoscience. It penalizes flexible schedules, creates false confidence in managers, and can be weaponized in performance reviews.

**Files to change:**

| File | Action |
|------|--------|
| `packages/shared/src/reports.ts:20-27` | Remove `BurnoutRiskEntry` interface |
| `packages/shared/src/reports.ts:47-67` | Remove `burnout_risks` from `ManagerSummary` |
| `packages/backend/src/db/queries.ts:1161-1245` | Delete `getBurnoutRiskSignals()` function |
| `packages/backend/src/services/reportComposers.ts:106` | Remove `getBurnoutRiskSignals()` call from `composeManagerSummary()` |
| `packages/backend/src/services/reportComposers.ts:130` | Remove `burnout_risks` from return object |
| `packages/dashboard/src/components/reports/manager/BurnoutRiskTable.tsx` | Delete entire file |
| `packages/dashboard/src/components/reports/manager/ManagerDashboard.tsx:4,36` | Remove BurnoutRiskTable import and usage |

**Replace with:** Nothing. Burnout is a human conversation, not a dashboard metric.

---

### 1.2 Remove Developer Leaderboards & Individual Rankings

**Why:** Ranking developers by prompt count or tool calls creates perverse incentives (inflate numbers), punishes different work styles (architecture, mentoring, reviews produce fewer events), and discourages collaboration.

**Files to change:**

| File | Action |
|------|--------|
| `packages/dashboard/src/components/insights/LeaderboardTable.tsx` | Rewrite as `TeamActivityTable` (see Phase 2) |
| `packages/dashboard/src/components/insights/DeveloperComparison.tsx` | Delete entire file |
| `packages/backend/src/db/queries.ts:438-458` | Rewrite `getDeveloperLeaderboard()` as `getTeamActivitySummary()` — aggregate only, no per-developer breakdown |
| `packages/backend/src/routes/insights.ts` | Remove `/insights/comparison` endpoint |
| `packages/shared/src/insights.ts:38-47` | Replace `DeveloperLeaderboardEntry` with `TeamActivityEntry` |
| Export routes | Remove `leaderboard` from `VALID_EXPORT_TYPES` or make it export team aggregates only |

---

### 1.3 Stop Storing Prompt Text

**Why:** Full prompt text is the developer's private conversation with their AI assistant. Capturing it is the digital equivalent of reading over someone's shoulder. It creates a chilling effect where developers self-censor their prompts, making them less effective with the tool.

**Files to change:**

| File | Action |
|------|--------|
| `packages/plugin/scripts/prompt-submit.sh:10-14` | Remove `--arg pt "$PROMPT"` and `promptText` from payload. Keep only `promptLength` and `isContinuation` |
| `packages/shared/src/events.ts:59-63` | Remove `promptText` from `PromptEventPayload` |
| `packages/dashboard/src/components/session/SessionTurnCard.tsx:33-41` | Replace prompt text display with "Prompt (N chars)" indicator |
| `packages/dashboard/src/components/session/SessionTurnCard.tsx:68-77` | Remove expanded prompt text view, show only character count |

**Note:** Existing `promptText` data in the database should be scrubbed via a migration that sets `payload = payload - 'promptText'` on all `prompt.submit` events.

---

### 1.4 Stop Storing Tool Inputs

**Why:** `toolInput` captures the full JSON input to every tool call — file contents, search queries, bash commands. This goes far beyond "what tools are being used" into "exactly what is the developer doing at every moment." Tool name + success/fail + duration is sufficient for team insights.

**Files to change:**

| File | Action |
|------|--------|
| `packages/plugin/scripts/tool-use.sh:14,25-29` | Remove `TOOL_INPUT` extraction and `toolInput` from payload |
| `packages/plugin/scripts/tool-complete.sh` | Remove `toolInput` from payload |
| `packages/shared/src/events.ts:65-72` | Remove `toolInput` from `ToolEventPayload` |

**Note:** Scrub existing data via migration: `UPDATE events SET payload = payload - 'toolInput' WHERE event_type IN ('tool.start', 'tool.complete', 'tool.fail')`.

---

### 1.5 Reframe "Stuck Sessions" → "Sessions Needing Attention"

**Why:** "Stuck" implies the developer is doing something wrong. High idle time may mean they're thinking, reading docs, or whiteboarding. The 5-minute threshold treats all non-typing time as problematic.

**Files to change:**

| File | Action |
|------|--------|
| `packages/dashboard/src/components/health/StuckSessionAlerts.tsx` | Rename to `SessionsNeedingAttention.tsx`. Change title to "Sessions with High Failure Rates". Remove idle time column entirely. Keep only failure rate — that's the actionable signal (the tool is erroring, not the developer). Increase threshold: only show sessions with >20% tool failure rate |
| `packages/shared/src/reports.ts:60-66` | Remove `idle_minutes` from stuck session type |
| Backend query for team health | Remove idle-time-based stuck session detection. Keep only failure-rate-based detection |

---

## Phase 2: Reframe as Team Empowerment

### 2.1 Team Activity Table (replaces Leaderboard)

Replace individual rankings with team-level aggregates. No developer names, no rankings.

**New component: `TeamActivityTable.tsx`**

Shows:
- **Total team sessions** this period (with trend vs. previous period)
- **Total prompts** across team
- **Total tool calls** across team
- **Active projects** count
- **Average session length**

No individual developer rows. No `#1`, `#2`, `#3`.

**Backend:** New `getTeamActivitySummary()` query that returns only aggregate counts, not per-developer breakdowns.

---

### 2.2 Project-Centric Views (replaces Developer-Centric)

Shift the lens from "who is doing what" to "how are our projects going."

**New/modified components:**

- **Project Health Cards**: For each active project, show total sessions, active developers (count only, not names), tool failure rate, and activity trend
- **Project Activity Timeline**: Time-based view of events per project, not per developer
- **Cross-Project Collaboration**: Show how many developers contribute to multiple projects (count only) — signals healthy knowledge sharing

**Backend:**
- Existing `getProjectActivity()` and `getProjectsOverview()` are good foundations
- Add `getProjectCollaborationMetrics()`: count of developers per project, overlap between projects

---

### 2.3 Team Tooling Health (replaces individual failure tracking)

Instead of "Developer X failed with tool Y", show team-level tooling insights:

**New component: `TeamToolingHealth.tsx`**

- **Most-used tools**: Which tools does the team rely on most?
- **Highest failure tools**: Which tools are causing problems team-wide? (No developer names)
- **Tool adoption trends**: Are new tools being picked up across the team?
- **Error patterns**: Common error messages grouped by tool (actionable for improving tooling/config)

This shifts from "who is failing" to "what tools need improvement" — an infrastructure concern, not a people concern.

---

### 2.4 Knowledge Sharing Indicators (new)

New metrics that celebrate collaboration rather than individual output:

- **Multi-project contributors**: How many team members work across projects? (Higher = better knowledge sharing)
- **Diverse tool usage**: Is the team leveraging the full tool suite or stuck on a few tools?
- **Session distribution**: Is work spread across the team or concentrated? (Gini coefficient of sessions — lower = healthier)

These are positive team health signals. None name individuals.

---

## Phase 3: Add Developer Agency

### 3.1 Self-Service Work Patterns (for developers, not managers)

**New component: `MyWorkPatterns.tsx`** (visible only to the authenticated developer for their own data)

- **My schedule heatmap**: When do I tend to work? (Personal insight, not surveillance)
- **My tool usage**: Which tools do I use most? Where do I hit errors?
- **My session trends**: Am I taking on too much? (Self-reflection, not manager review)

This is the ethical version of burnout detection: the developer chooses to look at their own patterns.

**Implementation:**
- New API endpoint: `GET /api/me/patterns` — returns data only for the authenticated developer's linked `developer_id`
- Protected by auth: no one else can access another developer's patterns
- Frontend route: `/dashboard/my-patterns`

---

### 3.2 Opt-In Visibility Toggle

**New:** Per-developer toggle in plugin/dashboard settings:

- **"Share detailed activity"** (default: OFF): When ON, team can see your session-level activity. When OFF, your events contribute to team aggregates but are not individually visible.
- **"Pause monitoring"** (temporary): Suspend all event capture for the current session.

**Implementation:**
- Add `visibility_preference` column to `developers` table: `'full' | 'aggregate_only'`
- Plugin checks a local config file `~/.config/devscope/preferences.json` for `monitoring_paused`
- Backend respects `aggregate_only`: includes events in team totals but omits from session detail views

---

### 3.3 Data Retention & Right to Delete

**New database migration:**

```sql
-- Add retention policy
ALTER TABLE organization_settings
  ADD COLUMN event_retention_days INTEGER DEFAULT 90;

-- Add developer data deletion tracking
CREATE TABLE data_deletion_requests (
  id TEXT PRIMARY KEY,
  developer_id TEXT REFERENCES developers(id),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending'
);
```

**New cron job:** `cleanupExpiredEvents.ts` — runs daily, deletes events older than `event_retention_days` per org.

**New API endpoint:** `DELETE /api/me/data` — developer can request deletion of all their events and sessions. Keeps only the developer record (name, id) for referential integrity, nullifying email.

---

### 3.4 Consent Banner in Plugin

**Modify:** `packages/plugin/scripts/session-start.sh`

On first run (when no `~/.config/devscope/consent.json` exists), the plugin should output a clear message to stderr:

```
[DevScope] This plugin sends session activity data to your team's DevScope instance.
[DevScope] Data collected: session start/end, tool names used, tool success/fail, session duration.
[DevScope] Data NOT collected: prompt text, tool inputs, file contents.
[DevScope] Configure: ~/.config/devscope/preferences.json
[DevScope] Privacy policy: https://your-devscope-instance/privacy
```

Then write `consent.json` with timestamp so this only shows once.

---

## Phase 4: Fix AI Reports

### 4.1 Remove Individual Developer Data from AI Prompts

**File:** `packages/backend/src/ai/workflows/reportWorkflow.ts`

The report workflow currently passes `getDeveloperLeaderboard()` data (individual developer names, emails, event counts) to the Gemini LLM.

**Change:** Replace with team aggregate data only. The AI report should analyze:
- Team velocity trends
- Project health
- Tool adoption & failure patterns
- Team collaboration metrics

Never individual developer performance.

### 4.2 Remove Persona-Based Productivity Framing

**File:** `packages/backend/src/ai/workflows/reportWorkflow.ts:98-100`

Current personas: CEO ("top-level KPIs"), CTO ("ROI metrics"), Engineering Manager ("operational focus").

**Change:** Remove "CEO" and "ROI" framing entirely. The tool should help teams improve their workflow, not help executives calculate return on headcount. Replace with:
- **Team Lead**: Focus on project progress, blockers, tool issues
- **Developer**: Focus on personal patterns, tool tips, workflow improvements

---

## Phase 5: Restrict Data Access

### 5.1 Export Controls

**File:** `packages/backend/src/routes/export.ts`

**Changes:**
- Require `admin` role for all exports
- Remove developer names/emails from exported data — replace with anonymized IDs
- Add audit logging: record who exported what and when

### 5.2 WebSocket Data Filtering

**File:** `packages/backend/src/routes/events.ts:99-102`

Currently broadcasts full event objects (including payload) to all connected dashboard clients.

**Change:** Strip `promptText` and `toolInput` from WebSocket broadcasts. Send only: event type, tool name, success/fail, developer name (if their visibility is set to `full`).

---

## Migration Strategy

### Database Migrations

1. **Scrub existing sensitive data:**
   ```sql
   UPDATE events SET payload = payload - 'promptText'
     WHERE event_type = 'prompt.submit' AND payload ? 'promptText';
   UPDATE events SET payload = payload - 'toolInput'
     WHERE event_type IN ('tool.start', 'tool.complete', 'tool.fail')
     AND payload ? 'toolInput';
   ```

2. **Add retention and consent columns:**
   ```sql
   ALTER TABLE organization_settings
     ADD COLUMN event_retention_days INTEGER DEFAULT 90;
   ALTER TABLE developers
     ADD COLUMN visibility_preference TEXT DEFAULT 'aggregate_only';
   ```

3. **Add audit table:**
   ```sql
   CREATE TABLE audit_log (
     id TEXT PRIMARY KEY,
     user_id TEXT,
     action TEXT,
     resource_type TEXT,
     details JSONB,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

### Feature Flags (for gradual rollout)

None. These are ethical requirements, not experimental features. Ship them all.

---

## Summary: Before → After

| Before (Surveillance) | After (Team Empowerment) |
|---|---|
| Developer Leaderboard (#1, #2, #3) | Team Activity Summary (aggregate only) |
| Burnout Risk Scoring per developer | Self-service "My Work Patterns" (developer-only) |
| Full prompt text capture | Prompt character count only |
| Full tool input capture | Tool name + success/fail + duration |
| "Stuck Sessions" with developer names + idle time | "Sessions with High Failure Rates" (tooling problem, not people problem) |
| Developer Comparison bar charts | Project Health views |
| Individual failure clusters by developer | Team Tooling Health (which tools need fixing?) |
| AI reports with developer names + "CEO ROI" | Team-level reports for leads and developers |
| No consent, no opt-out, no data deletion | Consent banner, opt-in visibility, right to delete, retention limits |
| Unrestricted exports with developer PII | Admin-only exports, anonymized, audit-logged |

---

## Files Affected (Complete List)

### Delete
- `packages/dashboard/src/components/reports/manager/BurnoutRiskTable.tsx`
- `packages/dashboard/src/components/insights/DeveloperComparison.tsx`

### Major Rewrite
- `packages/dashboard/src/components/insights/LeaderboardTable.tsx` → `TeamActivityTable.tsx`
- `packages/dashboard/src/components/health/StuckSessionAlerts.tsx` → `SessionsNeedingAttention.tsx`
- `packages/dashboard/src/components/session/SessionTurnCard.tsx` (remove prompt text display)
- `packages/dashboard/src/components/reports/manager/ManagerDashboard.tsx` (remove burnout, add team health)
- `packages/backend/src/services/reportComposers.ts` (remove burnout, add team metrics)
- `packages/backend/src/ai/workflows/reportWorkflow.ts` (remove individual data from AI prompts)

### Modify
- `packages/shared/src/reports.ts` (remove `BurnoutRiskEntry`, update `ManagerSummary`)
- `packages/shared/src/events.ts` (remove `promptText`, `toolInput`)
- `packages/shared/src/insights.ts` (replace `DeveloperLeaderboardEntry` with team types)
- `packages/plugin/scripts/prompt-submit.sh` (stop sending `promptText`)
- `packages/plugin/scripts/tool-use.sh` (stop sending `toolInput`)
- `packages/plugin/scripts/tool-complete.sh` (stop sending `toolInput`)
- `packages/plugin/scripts/session-start.sh` (add consent notice)
- `packages/backend/src/db/queries.ts` (remove burnout query, rewrite leaderboard as team aggregate)
- `packages/backend/src/routes/events.ts` (filter sensitive data from broadcasts)
- `packages/backend/src/routes/export.ts` (add role check, anonymize, audit log)
- `packages/backend/src/routes/insights.ts` (remove comparison endpoint)

### New Files
- `packages/dashboard/src/components/insights/TeamActivityTable.tsx`
- `packages/dashboard/src/components/insights/TeamToolingHealth.tsx`
- `packages/dashboard/src/components/insights/KnowledgeSharingIndicators.tsx`
- `packages/dashboard/src/components/me/MyWorkPatterns.tsx`
- `packages/backend/src/db/migrations/0XX_ethics_refactor.sql`
- `packages/backend/src/jobs/cleanupExpiredEvents.ts`

### Plugin (both repos)
- `packages/plugin/scripts/prompt-submit.sh`
- `packages/plugin/scripts/tool-use.sh`
- `packages/plugin/scripts/tool-complete.sh`
- `packages/plugin/scripts/session-start.sh`
- Remember: sync changes to `DowLucas/devscope-plugin` standalone repo
