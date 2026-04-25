/**
 * Suggestion promoter.
 *
 * Polls every 15 minutes, walks every active (non-suspended) repo
 * installation, aggregates anti-pattern evidence from sessions whose
 * `git_remote` matches the install's `owner/repo`, and promotes qualifying
 * clusters into `suggestion_candidates` rows for downstream workers.
 *
 * v1 only emits the `claude_md` kind. The `KIND_RULES` array is the single
 * place to add a new kind in Epic 9 — each rule describes how to gather
 * evidence and how to compute its `normalized_intent` for suppression keys.
 */

import { createHash } from "node:crypto";
import type { SQL } from "bun";
import type { EvidenceRefs, SuggestionKind } from "@devscope/shared";

import { listActiveInstallations } from "../db/repoInstallationQueries";
import {
  getRepoAntiPatternEvidence,
  type RepoAntiPatternEvidence,
} from "../db/patternQueries";
import {
  findActiveCandidate,
  findLastSettledCandidate,
  insertCandidate,
} from "../db/suggestionQueries";
import { getSuppression } from "../db/suppressionQueries";
import {
  computeEvidenceScore,
  type EvidenceScoreResult,
  type Severity,
} from "../services/evidenceScore";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const EVIDENCE_WINDOW_DAYS = 28;
/** Suppression carries until the evidence_score grows by more than this. */
const SUPPRESSION_GROWTH_OVERRIDE = 0.5;

// ---------------------------------------------------------------------------
// Per-kind threshold + intent rules
// ---------------------------------------------------------------------------

interface KindThreshold {
  /** Minimum overall evidence_score required before INSERT. */
  minScore: number;
  /** Minimum value of `breakdown.engineerDiversity` (≈ distinct users). */
  minEngineerDiversity: number;
}

const KIND_RULES: Array<{
  kind: SuggestionKind;
  threshold: KindThreshold;
  /** Compute the normalized intent string fed into the suppression key. */
  normalizedIntent: (cluster: AntiPatternCluster) => string;
}> = [
  {
    kind: "claude_md",
    threshold: { minScore: 0.3, minEngineerDiversity: 0.4 },
    normalizedIntent: (cluster) => {
      const tool = cluster.topTool ? cluster.topTool : "";
      return `claude_md|${normalize(cluster.antiPatternName)}|${normalize(tool)}`;
    },
  },
];

function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// Cluster shape — one anti-pattern's worth of repo evidence
// ---------------------------------------------------------------------------

interface AntiPatternCluster {
  antiPatternId: string;
  antiPatternName: string;
  severity: Severity;
  topTool: string | null;
  sessionIds: string[];
  developerIds: string[];
  perSessionCounts: number[];
  latestEventAt: Date;
}

function buildClusters(rows: RepoAntiPatternEvidence[]): AntiPatternCluster[] {
  const byApId = new Map<string, {
    antiPatternId: string;
    antiPatternName: string;
    severity: Severity;
    topToolCounts: Map<string, number>;
    sessionCounts: Map<string, number>;
    developerSet: Set<string>;
    latestMs: number;
  }>();

  for (const r of rows) {
    let entry = byApId.get(r.anti_pattern_id);
    if (!entry) {
      entry = {
        antiPatternId: r.anti_pattern_id,
        antiPatternName: r.anti_pattern_name,
        severity: (["critical", "warning", "info"] as Severity[]).includes(
          r.anti_pattern_severity as Severity
        )
          ? (r.anti_pattern_severity as Severity)
          : "warning",
        topToolCounts: new Map(),
        sessionCounts: new Map(),
        developerSet: new Set(),
        latestMs: 0,
      };
      byApId.set(r.anti_pattern_id, entry);
    }
    entry.sessionCounts.set(r.session_id, (entry.sessionCounts.get(r.session_id) ?? 0) + 1);
    entry.developerSet.add(r.developer_id);
    if (r.top_tool) {
      entry.topToolCounts.set(r.top_tool, (entry.topToolCounts.get(r.top_tool) ?? 0) + 1);
    }
    const tsMs = new Date(r.matched_at).getTime();
    if (Number.isFinite(tsMs) && tsMs > entry.latestMs) entry.latestMs = tsMs;
  }

  return Array.from(byApId.values()).map((entry) => {
    const sessionIds = Array.from(entry.sessionCounts.keys());
    const perSessionCounts = sessionIds.map((id) => entry.sessionCounts.get(id) ?? 0);
    const topTool = pickTop(entry.topToolCounts);
    return {
      antiPatternId: entry.antiPatternId,
      antiPatternName: entry.antiPatternName,
      severity: entry.severity,
      topTool,
      sessionIds,
      developerIds: Array.from(entry.developerSet),
      perSessionCounts,
      latestEventAt: new Date(entry.latestMs || Date.now()),
    };
  });
}

function pickTop(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Suppression key — sha256(repoInstallId || kind || normalized_intent)
// ---------------------------------------------------------------------------

export function buildSuppressionKey(
  repoInstallationId: string,
  kind: SuggestionKind,
  normalizedIntent: string
): string {
  return createHash("sha256")
    .update(repoInstallationId)
    .update("|")
    .update(kind)
    .update("|")
    .update(normalizedIntent)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Core promotion logic — pure-ish, exported for testing.
// ---------------------------------------------------------------------------

export async function promoteForInstallation(
  sql: SQL,
  install: { id: string; owner: string; repo: string },
  now: Date = new Date()
): Promise<number> {
  const ownerRepo = `${install.owner.toLowerCase()}/${install.repo.toLowerCase()}`;
  // Cover both HTTPS and SSH remotes — and the optional `.git` suffix — via
  // case-insensitive LIKE patterns ending in the normalized owner/repo. The
  // `%` prefix tolerates `https://`, `git@`, userinfo, and hostnames.
  const patterns = [`%${ownerRepo}`, `%${ownerRepo}.git`];

  const evidence = await getRepoAntiPatternEvidence(sql, patterns, EVIDENCE_WINDOW_DAYS);
  if (evidence.length === 0) return 0;

  const clusters = buildClusters(evidence);
  let inserted = 0;

  for (const rule of KIND_RULES) {
    for (const cluster of clusters) {
      const intent = rule.normalizedIntent(cluster);
      const suppressionKey = buildSuppressionKey(install.id, rule.kind, intent);

      const scored = computeEvidenceScore({
        sessionIds: cluster.sessionIds,
        userIds: cluster.developerIds,
        latestEventAt: cluster.latestEventAt,
        perSessionCounts: cluster.perSessionCounts,
        severities: [cluster.severity],
        now,
      });

      // Threshold gate
      if (
        scored.score < rule.threshold.minScore ||
        scored.breakdown.engineerDiversity < rule.threshold.minEngineerDiversity
      ) {
        continue;
      }

      // Suppression check (cooldown + >50% growth override)
      if (await isSuppressed(sql, suppressionKey, scored, now)) continue;

      // Idempotency: don't re-queue if an active candidate already exists.
      const existing = await findActiveCandidate(sql, suppressionKey);
      if (existing) continue;

      const refs: EvidenceRefs = {
        patternIds: [],
        antiPatternIds: [cluster.antiPatternId],
        sessionIds: cluster.sessionIds,
        insightIds: [],
      };

      await insertCandidate(sql, {
        id: crypto.randomUUID(),
        repoInstallationId: install.id,
        kind: rule.kind,
        evidenceRefs: refs,
        evidenceScore: scored.score,
        evidenceBreakdown: scored.breakdown,
        summary: buildSummary(cluster),
        suppressionKey,
        priority: Math.round(scored.score * 100),
        status: "queued",
      });
      inserted += 1;
    }
  }

  return inserted;
}

async function isSuppressed(
  sql: SQL,
  suppressionKey: string,
  scored: EvidenceScoreResult,
  now: Date
): Promise<boolean> {
  const suppression = await getSuppression(sql, suppressionKey);
  if (!suppression) return false;

  const nextEligibleMs = new Date(suppression.nextEligibleAt).getTime();
  if (nextEligibleMs <= now.getTime()) return false; // cooldown elapsed

  // Cooldown still active: only override if the cluster's evidence_score has
  // grown by more than 50% since the most recent dismissed/failed candidate
  // for the same suppression_key. If we have no prior candidate to compare
  // against, the cooldown stands (suppression came from outside the promoter,
  // e.g. reviewer rejection without a recorded score).
  const prior = await findLastSettledCandidate(sql, suppressionKey);
  if (!prior) return true;
  const grewEnough = scored.score > prior.evidenceScore * (1 + SUPPRESSION_GROWTH_OVERRIDE);
  return !grewEnough;
}

function buildSummary(cluster: AntiPatternCluster): string {
  const sessions = cluster.sessionIds.length;
  const users = cluster.developerIds.length;
  return `Address ${cluster.antiPatternName} (${sessions} session${sessions === 1 ? "" : "s"}, ${users} user${users === 1 ? "" : "s"})`;
}

// ---------------------------------------------------------------------------
// Job entry point
// ---------------------------------------------------------------------------

export async function runPromoterOnce(sql: SQL, now: Date = new Date()): Promise<void> {
  const installs = await listActiveInstallations(sql);
  let totalInserted = 0;
  for (const install of installs) {
    try {
      totalInserted += await promoteForInstallation(sql, install, now);
    } catch (err) {
      console.error(
        `[suggestion-promoter] Failed for install ${install.id} (${install.owner}/${install.repo}):`,
        err
      );
    }
  }
  if (totalInserted > 0) {
    console.log(`[suggestion-promoter] Queued ${totalInserted} new candidate(s)`);
  }
}

export function startSuggestionPromoter(sql: SQL): void {
  const g = globalThis as any;
  if (g.__gc_suggestion_promoter_interval) {
    clearInterval(g.__gc_suggestion_promoter_interval);
  }

  g.__gc_suggestion_promoter_interval = setInterval(() => {
    runPromoterOnce(sql).catch((err) => {
      console.error("[suggestion-promoter] Tick failed:", err);
    });
  }, POLL_INTERVAL_MS);

  console.log(
    `[suggestion-promoter] Scheduled every ${POLL_INTERVAL_MS / 60_000} minutes`
  );
}
