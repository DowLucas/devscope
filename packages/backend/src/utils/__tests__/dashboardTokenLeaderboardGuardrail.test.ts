import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * DEV-98 mission-gate regression: cross-package source scan.
 *
 * The dashboard package has no test runner, and the dashboard surfaces
 * tokens + cost in only two intended places:
 *
 *   - `components/insights/TokenUsageCards.tsx` — team-aggregate metric cards.
 *   - `components/insights/charts/TokenUsageChart.tsx` — team-aggregate area
 *     chart (no developer dimension).
 *
 * The mission gate (`team workflow visibility, not individual surveillance`)
 * forbids any per-developer leaderboard, ranking, or sort on tokens/cost.
 * This test scans the dashboard source tree for the textual fingerprints
 * of such a surface so CI flags it the moment someone adds it. The check
 * is intentionally textual (not AST-based) because the goal is to be the
 * loudest possible tripwire on a generic shape — false positives are fine
 * and correctable in code review; a silent false negative is not.
 *
 * If a legitimate aggregate-only surface trips this, *narrow the scan*
 * via the per-line allow-list below — do not weaken the patterns.
 */

const DASHBOARD_SRC = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "dashboard",
  "src",
);

/** File globs (suffix match) that are allowed to mention tokens/cost
 * alongside per-developer concepts. Only files whose RELATIVE path under
 * `packages/dashboard/src` ends with one of these suffixes can carry an
 * allow-list. */
const ALLOWED_FILES = new Set<string>([
  // DeveloperDrillDown is the existing self-only primitive (DEV-31). It
  // does NOT request /insights/tokens — it only fetches activity, tools,
  // sessions, projects, hourly. If a future change adds tokens to its
  // hooks, add an explicit per-line entry here AND raise it in the PR.
  "components/insights/DeveloperDrillDown.tsx",
  // SessionDetail shows token totals to the session owner only (self-view
  // gate, DEV-98). Per-session is by definition per-developer; that is
  // allowed because the gate is enforced at the component level.
  "components/session/SessionDetail.tsx",
]);

/** Patterns whose co-occurrence with a token/cost reference on the same
 * line indicates a leaderboard/ranking/per-dev-slicing surface. */
const FORBIDDEN_NEIGHBOURS: Array<{ name: string; rx: RegExp }> = [
  { name: "leaderboard", rx: /\bleaderboard\b/i },
  { name: "ranking", rx: /\branking\b/i },
  { name: "topDevelopers", rx: /\btop[_-]?developers?\b/i },
  { name: "byDeveloper", rx: /\bby[_-]?developer\b/i },
  { name: "perDeveloper", rx: /\bper[_-]?developer\b/i },
];

const TOKEN_OR_COST = /\b(token|tokens|cost|costs|burn[_-]?rate|spend)\b/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip build outputs and node_modules.
      if (entry === "node_modules" || entry === "dist" || entry === "build") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function relPath(absPath: string): string {
  return relative(DASHBOARD_SRC, absPath).split(sep).join("/");
}

function isAllowedFile(rel: string): boolean {
  for (const suffix of ALLOWED_FILES) {
    if (rel.endsWith(suffix)) return true;
  }
  return false;
}

describe("dashboard token/cost surfaces — mission-gate guardrail", () => {
  test("no per-developer leaderboard, ranking, or slicing on tokens or cost", () => {
    const files = walk(DASHBOARD_SRC);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const file of files) {
      const rel = relPath(file);
      if (isAllowedFile(rel)) continue;

      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (!TOKEN_OR_COST.test(line)) return;
        for (const { name, rx } of FORBIDDEN_NEIGHBOURS) {
          if (rx.test(line)) {
            violations.push(
              `${rel}:${idx + 1} mentions "${name}" alongside tokens/cost: ${line.trim()}`,
            );
          }
        }
      });
    }

    // Helpful failure message: list every offending site.
    expect(violations).toEqual([]);
  });

  test("the only insights endpoints called for tokens are the aggregate routes", () => {
    // Cross-check: the dashboard must hit `/api/insights/tokens` and
    // `/api/insights/tokens/over-time` — never construct a token endpoint
    // with a developerId path or query. Catch obvious regressions like
    // `/api/insights/tokens/${developerId}` or
    // `/api/insights/tokens?developerId=`.
    const files = walk(DASHBOARD_SRC);
    const offenders: string[] = [];

    const PER_DEV_TOKEN_URL =
      /["'`]\/api\/insights\/tokens(?:\/over-time)?\/\$\{[^}]*develop/i;
    const TOKEN_QUERY_DEV =
      /["'`]\/api\/insights\/tokens(?:\/over-time)?\?[^"'`]*\bdeveloper(?:Id)?=/i;

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (PER_DEV_TOKEN_URL.test(text) || TOKEN_QUERY_DEV.test(text)) {
        offenders.push(relPath(file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
