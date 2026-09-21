import type { SQL } from "bun";
import { choice, noul } from "@typesafe-ai/sdk";
import { askSystemOne, isTypeSafeAvailable, CONFIDENCE } from "../typesafe";
import { logEthicsEvent } from "../../utils/ethicsAudit";

/**
 * Intent routing for the chat surface (B7).
 *
 * `queryWorkflow` answers a question by handing it straight to Gemini with the
 * full tool declarations, then running a LangGraph tool loop, and only checks
 * the *output* for individual-targeting via `validateAndRedactTeamOutput`.
 *
 * That ordering has two costs. A question like "who has the highest failure
 * rate?" burns a Gemini call and a round of tool queries before the grounding
 * check refuses it — and those tool queries run against real per-developer
 * rows on the way. Checking the *question* first is both cheaper and a
 * stronger guarantee: the data is never fetched at all.
 *
 * Two atomic questions rather than one:
 *
 *   `targets_individual` — is this asking about a specific person?
 *   `scope`             — what kind of question is it?
 *
 * Fails open. A null verdict means the router could not run, and the question
 * proceeds exactly as it does today, still covered by the output-side
 * grounding check. This adds a gate; it never removes one.
 */

/** Chat is interactive — the router must not add noticeable latency. */
const TIMEOUT_MS = 2_500;

const MAX_QUESTION_CHARS = 2_000;

const TARGETS_INDIVIDUAL_QUESTION =
  "Is this question asking about one specific person — their activity, performance, habits, or how they compare to others? Count questions that identify someone by name, by role, or by what they own. Do NOT count questions about the team as a whole, about a project, about a tool, or about the asker's own sessions.";

const SCOPE_CRITERIA = {
  team_analytics:
    "Aggregate metrics about the team, projects, tools, or time periods",
  session_lookup:
    "Details of a particular session, or the asker's own recent activity",
  tooling_help:
    "How to use DevScope or Claude Code itself, or what some metric means",
  unsupported:
    "Not answerable from developer session data at all — unrelated to this product",
} as const;

export type QueryScope = keyof typeof SCOPE_CRITERIA;

export interface QueryRoute {
  /** Refuse before any data is fetched. */
  block: boolean;
  scope: QueryScope;
  targetsIndividual: number;
  scopeConfidence: number;
}

/**
 * P(yes) at or above which the question is treated as targeting an individual.
 * High bar: a false block refuses a legitimate question, which is a visible
 * failure, and the output-side check still backstops anything that slips past.
 */
const BLOCK_THRESHOLD = 0.85;

export const INDIVIDUAL_REFUSAL =
  "DevScope reports team-level patterns, not individual activity — it is built to improve shared tooling, not to compare people. " +
  "Try asking in team terms instead, for example \"how is the team's Bash failure rate trending?\" or \"which tools fail most often this month?\".";

/**
 * Route a question. Returns null when routing could not run, in which case the
 * caller proceeds unchanged.
 */
export async function routeQuery(
  sql: SQL,
  question: string,
  orgId?: string | null,
): Promise<QueryRoute | null> {
  if (!isTypeSafeAvailable() || !question.trim()) return null;

  const result = await askSystemOne(
    { question: question.slice(0, MAX_QUESTION_CHARS) },
    {
      targets_individual: noul(TARGETS_INDIVIDUAL_QUESTION),
      scope: choice("What kind of question is this?", SCOPE_CRITERIA),
    },
    {
      feature: "chat-routing",
      sql,
      orgId: orgId ?? undefined,
      timeoutMs: TIMEOUT_MS,
      maxRetries: 0,
    },
  );
  if (!result) return null;

  const targets = result.answers.targets_individual;
  const scope = result.answers.scope;
  if (targets.type !== "noul" || scope.type !== "choice") return null;

  const block = targets.noul >= BLOCK_THRESHOLD;

  if (block) {
    // Record the refusal for the same pilot audit the output-side check feeds,
    // so both directions of the guard are visible in one place.
    try {
      logEthicsEvent(sql, orgId ?? null, "ai_individual_reference_blocked", {
        surface: "chat",
        action: "blocked_at_input",
        targets_individual: targets.noul,
        scope: scope.choice,
      });
    } catch (err) {
      console.error("[chat-routing] failed to record audit event", err);
    }
    console.warn(
      `[chat-routing] blocked at input p=${targets.noul.toFixed(2)} scope=${scope.choice}`,
    );
  }

  return {
    block,
    scope: scope.choice as QueryScope,
    targetsIndividual: targets.noul,
    // Below the floor the scope read is not worth acting on; the caller treats
    // it as "route normally" rather than short-circuiting on a guess.
    scopeConfidence: scope.confidence,
  };
}

/** Is the scope read solid enough to short-circuit an unsupported question? */
export function canShortCircuit(route: QueryRoute): boolean {
  return route.scope === "unsupported" && route.scopeConfidence >= CONFIDENCE.high;
}

export const UNSUPPORTED_ANSWER =
  "That question does not look like something DevScope can answer from your team's Claude Code session data. " +
  "Ask about sessions, tools, projects, failure patterns, or documentation gaps and I can dig into those.";
