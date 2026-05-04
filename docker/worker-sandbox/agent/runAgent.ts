// DevScope agent driver — Task 5.3.
//
// Runs INSIDE the sandbox container. Reads a candidate JSON object on STDIN,
// drives a bounded Claude tool-use loop with read-only filesystem tools
// scoped to /work/repo, and emits a draft JSON object on STDOUT.
//
// Contract:
//   STDIN  → CandidateInput (see types below)
//   STDOUT → DraftOutput   (always — even on failure: empty patch + diagnostic)
//
// Failure philosophy: NEVER throw out of main(). The verifier will surface
// an empty patch as a failed gate; the worker can read `error` for context.

import Anthropic from "@anthropic-ai/sdk";
import { toolReadFile, toolListDir, toolGrep } from "./tools";
import { scoreRubric, type RubricScores } from "./rubric";

// Sonnet 4.6 alias per project standards. The SDK accepts the short alias
// and resolves it to the latest dated snapshot. If a future SDK rejects the
// alias, swap to the dated tag (e.g. claude-sonnet-4-5-20250929).
const MODEL_ID = "claude-sonnet-4-6";

const MAX_ITERATIONS = 30;
const MAX_INPUT_TOKENS = 200_000;
const MAX_OUTPUT_TOKENS_PER_CALL = 4096;

// ---------------------------------------------------------------------------
// Types — local mirror of what the worker sends. Kept loose because the
// sandbox cannot import from @devscope/shared (separate Docker context).
// ---------------------------------------------------------------------------

interface ConventionProfile {
    titleFormat?: "conventional_commits" | "ticket_prefix" | "plain";
    branchFormat?: string;
    signOffRequired?: boolean;
    dcoRequired?: boolean;
}

interface EvidenceDetail {
    antiPatterns?: Array<{
        name: string;
        severity: string;
        suggestion: string;
        sampleErrors: string[];
    }>;
    patterns?: Array<{
        name: string;
        description: string;
        effectiveness: string;
    }>;
    sessionExcerpts?: Array<{
        sessionId: string;
        toolCall: string;
        error: string;
        timestamp: string;
    }>;
}

interface CandidateInput {
    id?: string;
    candidateId?: string;
    kind: string;
    evidence_refs?: {
        sessionIds: string[];
        patternIds: string[];
        antiPatternIds: string[];
        insightIds: string[];
    };
    evidenceRefs?: {
        sessionIds: string[];
        patternIds: string[];
        antiPatternIds: string[];
        insightIds: string[];
    };
    summary?: string;
    evidenceSummary?: string;
    evidenceDetail?: EvidenceDetail;
    convention_profile?: ConventionProfile;
    conventionProfile?: ConventionProfile;
    negative_examples?: Array<{ rejectionReason: string; rejectedAt: string }>;
    negativeExamples?: Array<{ rejectionReason: string; rejectedAt: string }>;
    repoPath?: string;
}

interface DraftOutput {
    patch: string;
    files_changed: string[];
    title: string;
    body: string;
    model: string;
    tool_call_count: number;
    input_tokens: number;
    output_tokens: number;
    /**
     * Supplementary rubric (Task 5.5). `null` when scoring was skipped
     * (empty patch / agent gave up) or failed (parse error / API error).
     * The worker computes `qualityRanking` from these scores.
     */
    rubric_scores: RubricScores | null;
    error?: string;
}

// ---------------------------------------------------------------------------
// Tool schemas (Anthropic SDK shape).
// ---------------------------------------------------------------------------

function toolDefinitions(): Anthropic.Tool[] {
    return [
        {
            name: "read_file",
            description:
                "Read a file from the repository. Path is relative to the repo root. " +
                "Output is capped at 64 KB; longer files are truncated.",
            input_schema: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Repo-relative path, e.g. 'CLAUDE.md' or 'src/index.ts'",
                    },
                },
                required: ["path"],
            },
        },
        {
            name: "list_dir",
            description:
                "List the contents of a directory. Path is relative to the repo root. " +
                "Use '.' for the repo root.",
            input_schema: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Repo-relative directory path. Use '.' for root.",
                    },
                },
                required: ["path"],
            },
        },
        {
            name: "grep",
            description:
                "Search the repository for a regex pattern. Optionally restrict to files " +
                "matching a glob (e.g. '*.md', '*.ts'). Output capped at 16 KB.",
            input_schema: {
                type: "object",
                properties: {
                    pattern: { type: "string", description: "Regex pattern (POSIX ERE)." },
                    glob: {
                        type: "string",
                        description: "Optional file glob, e.g. '*.md'.",
                    },
                },
                required: ["pattern"],
            },
        },
        {
            name: "propose_patch",
            description:
                "TERMINAL TOOL. Submit your final unified diff and PR copy. After calling " +
                "this you are done — the agent loop exits. Call exactly once. The diff " +
                "must apply cleanly with `git apply --check` against HEAD and may modify " +
                "ONLY CLAUDE.md files (root or any subdirectory).",
            input_schema: {
                type: "object",
                properties: {
                    unified_diff: {
                        type: "string",
                        description:
                            "A unified diff (`diff --git ...`) that adds or modifies CLAUDE.md.",
                    },
                    title: {
                        type: "string",
                        description: "PR title — short, imperative, under 70 chars.",
                    },
                    body: {
                        type: "string",
                        description:
                            "PR body in markdown. MUST cite the triggering session IDs and " +
                            "anti-pattern names from the evidence so a reviewer can audit.",
                    },
                },
                required: ["unified_diff", "title", "body"],
            },
        },
    ];
}

// ---------------------------------------------------------------------------
// Prompt assembly.
// ---------------------------------------------------------------------------

function buildSystemPrompt(
    repoPath: string,
    conventionProfile: ConventionProfile,
    negativeExamples: Array<{ rejectionReason: string; rejectedAt: string }>
): string {
    const negSection = negativeExamples.length
        ? negativeExamples
              .slice(0, 10)
              .map(
                  (n, i) =>
                      `${i + 1}. [${n.rejectedAt}] rejected because: ${n.rejectionReason}`
              )
              .join("\n")
        : "(none)";
    const titleFormat = conventionProfile.titleFormat ?? "plain";
    const signOff = conventionProfile.signOffRequired ?? false;

    return `You are a code-quality assistant for the DevScope project. Your job is to draft a focused improvement to a repository's CLAUDE.md file based on observed friction in Claude Code sessions on this repo.

You have read-only tools to inspect the repository at ${repoPath}. After investigation, you call \`propose_patch\` exactly once with a unified diff that adds or modifies a CLAUDE.md file.

CRITICAL CONSTRAINTS:
- Modify ONLY files matching \`**/CLAUDE.md\` (root or any subdirectory).
- Patches must apply cleanly with \`git apply --check\` against HEAD.
- Keep changes small and surgical — add ONE focused convention, gotcha, or workaround tied directly to the evidence. Resist sprawl.
- Use the project's existing tone and structure — match the existing CLAUDE.md style if one exists. If none exists, use a terse, scannable bullet list.
- The PR body must reference the specific evidence (session IDs by date) so the reviewer can audit the suggestion.
- If after exploration you believe no improvement is warranted (the evidence is too thin, the issue is already documented, or it is not actually a CLAUDE.md-level concern), call \`propose_patch\` with an empty unified_diff and explain why in the body.

NEGATIVE EXAMPLES (suggestions previously rejected for this repo):
${negSection}
Do not regenerate suggestions resembling these.

CONVENTIONS DETECTED FOR THIS REPO:
- PR title format: ${titleFormat}
- Sign-off required: ${signOff}

UNIFIED DIFF FORMAT:
- Use \`diff --git a/CLAUDE.md b/CLAUDE.md\` headers.
- For new files include \`new file mode 100644\` and \`--- /dev/null\`.
- Hunk headers MUST use accurate line numbers and counts (\`@@ -X,Y +X,Z @@\`).
- Context lines are required around modifications — git apply will reject patches without them.

Begin by exploring the repo with read_file/list_dir/grep, then call propose_patch.`;
}

function buildUserMessage(input: CandidateInput): string {
    const summary = input.evidenceSummary ?? input.summary ?? "(no summary provided)";
    const refs = input.evidenceRefs ?? input.evidence_refs ?? {
        sessionIds: [],
        patternIds: [],
        antiPatternIds: [],
        insightIds: [],
    };
    const detail = input.evidenceDetail ?? {};

    const lines: string[] = [];
    lines.push(`# Evidence summary`);
    lines.push(summary);
    lines.push("");
    lines.push(`# Evidence references`);
    lines.push(
        `- Sessions: ${refs.sessionIds.length ? refs.sessionIds.join(", ") : "(none)"}`
    );
    lines.push(
        `- Anti-patterns: ${refs.antiPatternIds.length ? refs.antiPatternIds.join(", ") : "(none)"}`
    );
    lines.push(
        `- Patterns: ${refs.patternIds.length ? refs.patternIds.join(", ") : "(none)"}`
    );
    lines.push(
        `- Insights: ${refs.insightIds.length ? refs.insightIds.join(", ") : "(none)"}`
    );

    if (detail.antiPatterns?.length) {
        lines.push("");
        lines.push(`# Observed anti-patterns`);
        for (const a of detail.antiPatterns) {
            lines.push(`## ${a.name} (severity: ${a.severity})`);
            lines.push(`Suggestion: ${a.suggestion}`);
            if (a.sampleErrors?.length) {
                lines.push(`Sample errors:`);
                for (const e of a.sampleErrors.slice(0, 5)) {
                    lines.push(`  - ${e}`);
                }
            }
        }
    }
    if (detail.patterns?.length) {
        lines.push("");
        lines.push(`# Effective patterns observed`);
        for (const p of detail.patterns) {
            lines.push(
                `- ${p.name} (effectiveness=${p.effectiveness}): ${p.description}`
            );
        }
    }
    if (detail.sessionExcerpts?.length) {
        lines.push("");
        lines.push(`# Session excerpts`);
        for (const s of detail.sessionExcerpts.slice(0, 10)) {
            lines.push(
                `- [${s.timestamp}] session=${s.sessionId} tool=${s.toolCall} error="${s.error}"`
            );
        }
    }
    lines.push("");
    lines.push(
        `Investigate the repo, then propose a single focused CLAUDE.md improvement.`
    );
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool dispatch.
// ---------------------------------------------------------------------------

export async function dispatchTool(
    name: string,
    input: unknown,
    repoPath: string
): Promise<{ content: string; isError: boolean }> {
    try {
        const i = (input ?? {}) as Record<string, unknown>;
        if (name === "read_file") {
            const out = await toolReadFile(repoPath, { path: String(i.path ?? "") });
            return { content: out, isError: false };
        }
        if (name === "list_dir") {
            const out = await toolListDir(repoPath, { path: String(i.path ?? "") });
            return { content: out, isError: false };
        }
        if (name === "grep") {
            const out = toolGrep(repoPath, {
                pattern: String(i.pattern ?? ""),
                glob: typeof i.glob === "string" ? i.glob : undefined,
            });
            return { content: out, isError: false };
        }
        return { content: `unknown tool: ${name}`, isError: true };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `tool error: ${msg}`, isError: true };
    }
}

// ---------------------------------------------------------------------------
// Output helpers.
// ---------------------------------------------------------------------------

function emptyDraft(
    error: string,
    extras: Partial<DraftOutput> = {}
): DraftOutput {
    return {
        patch: "",
        files_changed: [],
        title: "",
        body: "",
        model: MODEL_ID,
        tool_call_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        rubric_scores: null,
        error,
        ...extras,
    };
}

/**
 * Parse a unified diff and return the set of file paths it touches.
 * Mirrors verify/verifyPatch.ts logic — kept inline so we can populate
 * `files_changed` without reaching across the sandbox boundary.
 */
function filesTouchedByPatch(patch: string): string[] {
    const files = new Set<string>();
    const re = /^diff --git a\/(\S+) b\/(\S+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(patch)) !== null) {
        files.add(m[2]);
    }
    return [...files];
}

// ---------------------------------------------------------------------------
// Main agent loop.
// ---------------------------------------------------------------------------

export interface RunAgentDeps {
    /** Override for tests; defaults to a real Anthropic client. */
    client?: Anthropic;
    /** Override stdin reader (tests). */
    readStdin?: () => Promise<string>;
    /**
     * Override the rubric scorer. Tests inject a deterministic stub here
     * to avoid the second Anthropic call. Defaults to the real `scoreRubric`
     * which uses the same Anthropic client.
     */
    scoreRubric?: typeof scoreRubric;
}

export async function runAgent(deps: RunAgentDeps = {}): Promise<DraftOutput> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey && !deps.client) {
        return emptyDraft("ANTHROPIC_API_KEY not set");
    }

    const readStdin = deps.readStdin ?? (() => Bun.stdin.text());
    let raw: string;
    try {
        raw = await readStdin();
    } catch (err) {
        return emptyDraft(`stdin read failed: ${(err as Error).message}`);
    }

    let candidate: CandidateInput;
    try {
        candidate = JSON.parse(raw) as CandidateInput;
    } catch (err) {
        return emptyDraft(`stdin JSON parse failed: ${(err as Error).message}`);
    }

    const repoPath = candidate.repoPath ?? "/work/repo";
    const conventionProfile =
        candidate.conventionProfile ?? candidate.convention_profile ?? {};
    const negativeExamples =
        candidate.negativeExamples ?? candidate.negative_examples ?? [];

    const client =
        deps.client ?? new Anthropic({ apiKey: apiKey! });

    const systemPrompt = buildSystemPrompt(
        repoPath,
        conventionProfile,
        negativeExamples
    );
    const userMessage = buildUserMessage(candidate);
    const tools = toolDefinitions();

    // Apply ephemeral (5 min) prompt cache to the system prompt block — the
    // single-shot run reuses it across tool-result turns.
    const system: Anthropic.TextBlockParam[] = [
        {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
        },
    ];

    const messages: Anthropic.MessageParam[] = [
        { role: "user", content: userMessage },
    ];

    let totalInput = 0;
    let totalOutput = 0;
    let toolCallCount = 0;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        if (totalInput > MAX_INPUT_TOKENS) {
            return emptyDraft(
                `input token budget exceeded (${totalInput} > ${MAX_INPUT_TOKENS}) at iter ${iter}`,
                {
                    tool_call_count: toolCallCount,
                    input_tokens: totalInput,
                    output_tokens: totalOutput,
                }
            );
        }

        let response: Anthropic.Message;
        try {
            response = await client.messages.create({
                model: MODEL_ID,
                max_tokens: MAX_OUTPUT_TOKENS_PER_CALL,
                system,
                tools,
                messages,
            });
        } catch (err) {
            return emptyDraft(
                `Anthropic API error at iter ${iter}: ${(err as Error).message}`,
                {
                    tool_call_count: toolCallCount,
                    input_tokens: totalInput,
                    output_tokens: totalOutput,
                }
            );
        }

        const usage = response.usage as Anthropic.Usage & {
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
        };
        totalInput +=
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0);
        totalOutput += usage.output_tokens ?? 0;

        // Echo the assistant turn into the conversation.
        messages.push({ role: "assistant", content: response.content });

        // Find tool_use blocks; check for the terminal propose_patch first.
        const toolUses = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );

        const propose = toolUses.find((t) => t.name === "propose_patch");
        if (propose) {
            toolCallCount += 1;
            const inp = (propose.input ?? {}) as Record<string, unknown>;
            const patch =
                typeof inp.unified_diff === "string" ? inp.unified_diff : "";
            const title = typeof inp.title === "string" ? inp.title : "";
            const body = typeof inp.body === "string" ? inp.body : "";

            // Run the supplementary rubric only when the agent actually
            // proposed a non-empty patch. Empty patches (agent gave up)
            // skip scoring — there is nothing to rate. Failures inside
            // scoreRubric come back as `null` and never throw.
            const rubricFn = deps.scoreRubric ?? scoreRubric;
            let rubric: RubricScores | null = null;
            if (patch.trim().length > 0) {
                rubric = await rubricFn(
                    {
                        patch,
                        title,
                        body,
                        evidenceBlock: userMessage,
                    },
                    { client: deps.client }
                );
            }

            return {
                patch,
                files_changed: filesTouchedByPatch(patch),
                title,
                body,
                model: MODEL_ID,
                tool_call_count: toolCallCount,
                input_tokens: totalInput,
                output_tokens: totalOutput,
                rubric_scores: rubric,
            };
        }

        if (toolUses.length === 0) {
            // No tool calls and no propose_patch → assistant gave up.
            return emptyDraft(
                `assistant ended turn without calling propose_patch (stop_reason=${response.stop_reason})`,
                {
                    tool_call_count: toolCallCount,
                    input_tokens: totalInput,
                    output_tokens: totalOutput,
                }
            );
        }

        // Dispatch every read-only tool use and assemble a single user turn
        // containing the tool_result blocks (Anthropic's required pattern).
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
            toolCallCount += 1;
            const { content, isError } = await dispatchTool(
                tu.name,
                tu.input,
                repoPath
            );
            toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content,
                is_error: isError,
            });
        }
        messages.push({ role: "user", content: toolResults });
    }

    return emptyDraft(`max iterations (${MAX_ITERATIONS}) exceeded`, {
        tool_call_count: toolCallCount,
        input_tokens: totalInput,
        output_tokens: totalOutput,
    });
}

// ---------------------------------------------------------------------------
// Entry — only when invoked directly (not when imported by tests).
// ---------------------------------------------------------------------------

if (import.meta.main) {
    const draft = await runAgent();
    process.stdout.write(JSON.stringify(draft));
}
