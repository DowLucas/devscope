// Supplementary rubric scorer (Task 5.5).
//
// Runs a single-shot Claude Opus call against the agent's draft + the same
// evidence the agent saw, and parses three 0..1 ratings. NEVER throws — on
// any failure (API error, parse error, missing key) returns `null` and the
// caller persists the artifact without rubric scores.
//
// Important: this is NOT a gate. Low scores do not block progression; the
// worker uses `qualityRanking` (computed downstream from these scores) only
// for ordering when humans browse pending artifacts.

import Anthropic from "@anthropic-ai/sdk";

// Project standard alias. If a future SDK rejects the alias, swap to the
// dated tag below — adopt whichever resolves at runtime.
const RUBRIC_MODEL_ID = "claude-opus-4-7";
const RUBRIC_MODEL_FALLBACK = "claude-opus-4-5-20250929";

const RUBRIC_MAX_TOKENS = 256;

const RUBRIC_SYSTEM_PROMPT = `You are scoring a proposed CLAUDE.md improvement on three independent dimensions.
Be strict. Most plausible drafts deserve middling scores; only patches that demonstrably nail their criterion deserve >0.85.

Score each 0.0 to 1.0:
- clarity: is the change unambiguous, well-written, scoped, easy to understand at a glance?
- evidenceFit: does the change directly address the cited friction (anti-patterns, session excerpts), or is it a tangential improvement?
- reversibility: if this turns out to be wrong, how easily can it be reverted? Pure additive changes to CLAUDE.md score 1.0; replacements of multiple existing sections score lower.

Output ONLY a JSON object: {"clarity": 0.X, "evidenceFit": 0.X, "reversibility": 0.X}`;

export interface RubricScores {
    clarity: number;
    evidenceFit: number;
    reversibility: number;
}

export interface RubricInput {
    /** Unified diff produced by the agent. Required, non-empty. */
    patch: string;
    /** PR title proposed by the agent. */
    title: string;
    /** PR body proposed by the agent. */
    body: string;
    /** The user-message evidence block that was shown to the agent. */
    evidenceBlock: string;
}

export interface ScoreRubricDeps {
    /** Override for tests. Defaults to a real Anthropic client when omitted. */
    client?: Anthropic;
    /** Override the logger used to surface parse failures. */
    log?: (msg: string, fields?: Record<string, unknown>) => void;
}

/**
 * Run the supplementary rubric. Returns the parsed scores on success, or
 * `null` on any failure (API error, parse error, missing key).
 */
export async function scoreRubric(
    input: RubricInput,
    deps: ScoreRubricDeps = {}
): Promise<RubricScores | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey && !deps.client) {
        return null;
    }
    const client = deps.client ?? new Anthropic({ apiKey: apiKey! });
    const log = deps.log ?? (() => {});

    const userContent = [
        "# Evidence shown to the drafting agent",
        input.evidenceBlock,
        "",
        "# Proposed PR title",
        input.title,
        "",
        "# Proposed PR body",
        input.body,
        "",
        "# Proposed unified diff",
        "```diff",
        input.patch,
        "```",
        "",
        "Score the three dimensions and output ONLY the JSON object.",
    ].join("\n");

    const tryModel = async (modelId: string) => {
        return client.messages.create({
            model: modelId,
            max_tokens: RUBRIC_MAX_TOKENS,
            system: RUBRIC_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userContent }],
        });
    };

    let response: Anthropic.Message;
    try {
        response = await tryModel(RUBRIC_MODEL_ID);
    } catch (err) {
        // The alias may be rejected by some SDKs; retry once with the dated
        // snapshot before giving up. Any further error → null.
        const msg = err instanceof Error ? err.message : String(err);
        log("rubric primary model failed, trying fallback", { err: msg });
        try {
            response = await tryModel(RUBRIC_MODEL_FALLBACK);
        } catch (err2) {
            const msg2 = err2 instanceof Error ? err2.message : String(err2);
            log("rubric fallback model failed", { err: msg2 });
            return null;
        }
    }

    const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

    return parseRubricJson(text, log);
}

/**
 * Extract a JSON object from the model's response. Tolerates surrounding
 * markdown fences or extra prose. Validates each field is in [0, 1]; clamps
 * out-of-range values rather than rejecting outright.
 */
export function parseRubricJson(
    raw: string,
    log: (msg: string, fields?: Record<string, unknown>) => void = () => {}
): RubricScores | null {
    // Find the first {...} block. Greedy match handles nested-free single object.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
        log("rubric parse failed: no JSON object", { raw: raw.slice(0, 200) });
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(match[0]);
    } catch (err) {
        log("rubric parse failed: invalid JSON", {
            raw: raw.slice(0, 200),
            err: (err as Error).message,
        });
        return null;
    }
    if (!parsed || typeof parsed !== "object") {
        log("rubric parse failed: not an object", { raw: raw.slice(0, 200) });
        return null;
    }
    const obj = parsed as Record<string, unknown>;
    const c = numOrNull(obj.clarity);
    const e = numOrNull(obj.evidenceFit);
    const r = numOrNull(obj.reversibility);
    if (c === null || e === null || r === null) {
        log("rubric parse failed: missing field", {
            raw: raw.slice(0, 200),
            keys: Object.keys(obj),
        });
        return null;
    }
    return {
        clarity: clamp01(c),
        evidenceFit: clamp01(e),
        reversibility: clamp01(r),
    };
}

function numOrNull(v: unknown): number | null {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function clamp01(n: number): number {
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}
