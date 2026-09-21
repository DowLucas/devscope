import {
  TypeSafeClient,
  type Questions,
  type SystemOneResult,
  type EntryType,
} from "@typesafe-ai/sdk";
import type { SQL } from "bun";
import { recordTokenUsage } from "../db/aiQueries";

/**
 * TypeSafe System One client (Jev).
 *
 * Complements `gemini.ts` rather than replacing it. Gemini generates prose;
 * TypeSafe answers typed questions (Choice / Score / Noul) and returns
 * probabilities plus calibrated confidence. It cannot emit free text at all,
 * which is why the mission-critical surfaces prefer it: a model with no text
 * channel cannot leak a developer name.
 *
 * Every call site MUST have a fallback. `askSystemOne` never throws — it
 * returns null on missing key, timeout, rate limit, or any API error, and the
 * caller drops back to its existing behaviour. This mirrors the discipline in
 * `nudgeWorkflow.ts`, where a slow model falls back to a static template.
 *
 * TypeSafe's published rate limits are explicitly volatile ("can change
 * without notice"), so treat availability as best-effort everywhere, and
 * especially on the live hook path.
 */

const TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY;
if (!TYPESAFE_API_KEY) {
  console.warn("[typesafe] TYPESAFE_API_KEY not set — System One features will fall back");
}

/** Default per-attempt timeout. Batch jobs override this upward. */
const DEFAULT_TIMEOUT_MS = 8_000;

export const DEFAULT_TYPESAFE_MODEL = process.env.TYPESAFE_MODEL ?? "jev-latest";

const client = TYPESAFE_API_KEY
  ? new TypeSafeClient({
      apiKey: TYPESAFE_API_KEY,
      defaultModel: DEFAULT_TYPESAFE_MODEL,
      timeout: DEFAULT_TIMEOUT_MS,
      // Never log request bodies: state carries session and prompt content.
      logLevel: "warn",
    })
  : null;

export function isTypeSafeAvailable(): boolean {
  return client !== null;
}

export interface AskOptions {
  /** Per-attempt timeout in ms. Defaults to the client's 8s. */
  timeoutMs?: number;
  /** Hard ceiling on total wall-clock time including retries. */
  budgetMs?: number;
  /** Retry count override; 0 disables retries (use on the live hook path). */
  maxRetries?: number;
  /** Model override, e.g. a pinned version once thresholds are tuned. */
  model?: string;
  /** Feature label for `ai_token_usage`. Omit to skip usage recording. */
  feature?: string;
  /** Required when `feature` is set. */
  sql?: SQL;
  /** Organization to attribute usage to, when known. */
  orgId?: string;
}

/**
 * Ask System One a set of typed questions about one state.
 *
 * Returns null on any failure. Callers fall back to prior behaviour.
 *
 * All questions are evaluated in parallel and in isolation against the same
 * state, so adding questions barely moves latency. Prefer one call with many
 * questions over many calls (see the speculative fan-out pattern).
 */
export async function askSystemOne<Q extends Questions>(
  state: EntryType,
  questions: Q,
  opts: AskOptions = {},
): Promise<SystemOneResult<Q> | null> {
  if (!client) return null;

  const controller = new AbortController();
  const budget = opts.budgetMs
    ? setTimeout(() => controller.abort(), opts.budgetMs)
    : null;

  try {
    const result = await client.systemOne(
      { state, questions, ...(opts.model ? { model: opts.model } : {}) },
      {
        signal: controller.signal,
        ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
        ...(opts.maxRetries !== undefined
          ? { retry: { maxRetries: opts.maxRetries } }
          : {}),
      },
    );

    if (opts.feature && opts.sql) {
      // Output tokens are free on TypeSafe, but record both so the existing
      // cost dashboards can tell the two vendors apart by model name.
      try {
        await recordTokenUsage(
          opts.sql,
          opts.feature,
          result.model,
          result.usage.input_tokens,
          result.usage.output_tokens,
          opts.orgId,
        );
      } catch (err) {
        console.warn("[typesafe] usage recording failed:", err);
      }
    }

    return result;
  } catch (err) {
    console.warn(
      `[typesafe] systemOne failed${opts.feature ? ` (${opts.feature})` : ""}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    if (budget) clearTimeout(budget);
  }
}

/**
 * Confidence bands for Choice and Score answers.
 *
 * The docs recommend three ranges, with the boundaries set by the stakes of
 * the action rather than one global number. These are conservative starting
 * points; tune per surface against real data before loosening.
 *
 * Note that Noul answers carry no `confidence` field — only the `noul`
 * probability. For a Noul, gate on distance from 0.5 instead.
 */
export const CONFIDENCE = {
  /** Act automatically. */
  high: 0.85,
  /** Act, but flag or ask for confirmation. */
  medium: 0.6,
  /** Below this the model is genuinely unsure — do not act on the answer. */
  floor: 0.5,
} as const;

export type ConfidenceBand = "high" | "medium" | "low";

export function bandFor(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE.high) return "high";
  if (confidence >= CONFIDENCE.medium) return "medium";
  return "low";
}

/**
 * How decisive a Noul probability is, as a 0-1 value.
 *
 * A Noul returns P(yes). 0.5 is maximum uncertainty and both extremes are
 * maximally decisive, so decisiveness is the normalised distance from 0.5.
 * Use it wherever the Choice/Score `confidence` field would be used.
 */
export function noulDecisiveness(noul: number): number {
  return Math.min(1, Math.max(0, Math.abs(noul - 0.5) * 2));
}
