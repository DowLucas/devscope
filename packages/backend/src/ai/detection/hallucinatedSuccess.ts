import type { ToolEvent } from "../../db/patternQueries";

// Detects when a session response claims success/completion but no
// verification tool (test, build, run, type-check, browser check) actually
// fired in the trailing window of tool calls. This catches the common
// "I think I'm done" pattern without evidence — the gap that /devscope:review
// would otherwise only catch post-hoc.
//
// Pure function. No DB. Run from the patternAnalysis batch job and on-demand.

const SUCCESS_PHRASE = /\b(done|fixed|complete(d)?|works|passing|all set|ready to (ship|merge|deploy)|tests? pass|build (succeeds?|passes))\b/i;

const VERIFICATION_TOOL = /^(Bash|mcp__playwright__|mcp__claude-in-chrome__|TestRun)/;
const VERIFICATION_BASH_PATTERN =
  /\b(test|tests|vitest|jest|pytest|cargo test|go test|npm test|bun test|yarn test|tsc|eslint|build|cargo build|go build|npm run|bun run|yarn run|playwright|cypress|curl|http)\b/i;

const TRAILING_WINDOW = 8;

export interface HallucinatedSuccessDetection {
  rule: "hallucinated_success";
  name: string;
  description: string;
  severity: "warning";
  suggestion: string;
  details: {
    matched_phrase: string;
    trailing_tool_count: number;
    trailing_tools: string[];
  };
}

export interface HallucinatedSuccessInput {
  toolSequence: ToolEvent[];
  bashSubcommandsTrailing?: (string | null | undefined)[];
  responseText: string | null | undefined;
}

/**
 * Did a verification-shaped tool actually run in the trailing window?
 *
 * This is a question about facts, not language: the tool sequence comes
 * straight from the event log, so code answers it, never a model. Exported so
 * the TypeSafe path can reuse it and replace only the language judgment.
 */
export function hasVerificationInWindow(
  input: Pick<HallucinatedSuccessInput, "toolSequence" | "bashSubcommandsTrailing">,
): { verified: boolean; trailing: ToolEvent[] } {
  const trailing = input.toolSequence.slice(-TRAILING_WINDOW);
  if (trailing.length === 0) return { verified: false, trailing };

  for (let i = 0; i < trailing.length; i++) {
    const t = trailing[i]!;
    if (!VERIFICATION_TOOL.test(t.tool_name)) continue;
    if (t.tool_name !== "Bash") {
      // Any playwright/browser tool counts as verification by itself.
      return { verified: true, trailing };
    }
    // For Bash, require a verification-shaped subcommand (if available)
    // or fall back to allowing it (we err on the side of not flagging).
    const sub = input.bashSubcommandsTrailing?.[i];
    if (typeof sub === "string" && VERIFICATION_BASH_PATTERN.test(sub)) {
      return { verified: true, trailing };
    }
    if (sub === undefined) {
      // Unknown subcommand — be conservative, do not flag.
      return { verified: true, trailing };
    }
  }

  return { verified: false, trailing };
}

/**
 * Build the detection record for a session whose response claimed success
 * without a verification step.
 *
 * `claimEvidence` is whatever identified the claim: the matched regex phrase
 * on the local path, or a short model-provided label on the TypeSafe path.
 */
export function buildHallucinatedSuccessDetection(
  claimEvidence: string,
  trailing: ToolEvent[],
): HallucinatedSuccessDetection {
  const description =
    trailing.length === 0
      ? `Response claimed "${claimEvidence}" but no tools were invoked in this session segment.`
      : `Response claimed "${claimEvidence}" but no test, build, or verification tool ran in the last ${trailing.length} tool calls.`;

  return {
    rule: "hallucinated_success",
    name: "Unverified Success Claim",
    description,
    severity: "warning",
    suggestion:
      "Before reporting work as done, run the project's tests, build, or a relevant verification (curl, browser check). If verification isn't possible, say so explicitly rather than implying success.",
    details: {
      matched_phrase: claimEvidence,
      trailing_tool_count: trailing.length,
      trailing_tools: trailing.map((t) => t.tool_name),
    },
  };
}

/**
 * Local regex detector.
 *
 * Retained as the fallback whenever TypeSafe is unavailable, and as the
 * reference implementation the model path is shadow-compared against.
 * Its weakness is the fixed `SUCCESS_PHRASE` alternation: it misses paraphrases
 * ("that should do it") and false-positives on negated language
 * ("the build failed, though tests pass locally").
 */
export function detectHallucinatedSuccess(
  input: HallucinatedSuccessInput,
): HallucinatedSuccessDetection | null {
  const text = input.responseText;
  if (!text || typeof text !== "string") return null;

  const m = text.match(SUCCESS_PHRASE);
  if (!m) return null;

  const { verified, trailing } = hasVerificationInWindow(input);
  if (verified) return null;

  return buildHallucinatedSuccessDetection(m[0], trailing);
}
