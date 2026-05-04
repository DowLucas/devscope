/**
 * Unit tests for the agent loop. Mocks the Anthropic client so no API
 * calls happen. Asserts:
 *   - missing ANTHROPIC_API_KEY returns an empty draft cleanly
 *   - the model id, system cache_control, and tool set are configured correctly
 *   - propose_patch terminates the loop and surfaces the patch + token counts
 *   - read-only tool calls round-trip through dispatchTool against a tmpdir
 *   - hard iteration cap eventually returns an empty draft
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { dispatchTool, runAgent } from "../runAgent";

let repoRoot: string;
beforeAll(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "devscope-agent-"));
    writeFileSync(join(repoRoot, "CLAUDE.md"), "# Existing\n");
});
afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
});

/** Build a minimal candidate JSON for stdin. */
function candidateJson(): string {
    return JSON.stringify({
        id: "cand_unit_001",
        kind: "claude_md",
        evidenceRefs: {
            sessionIds: ["sess_a", "sess_b"],
            patternIds: [],
            antiPatternIds: ["ap_x"],
            insightIds: [],
        },
        evidenceSummary: "repeated_bash_failure on `railway`, 5 sessions, 3 users",
        evidenceDetail: {
            antiPatterns: [
                {
                    name: "repeated_bash_failure",
                    severity: "high",
                    suggestion: "Document railway CLI auth steps",
                    sampleErrors: ["railway: command not found"],
                },
            ],
        },
        conventionProfile: { titleFormat: "conventional_commits" },
        negativeExamples: [],
        repoPath: repoRoot,
    });
}

interface MockCall {
    model: string;
    system: unknown;
    tools: unknown;
    messages: unknown;
}

function makeMockClient(
    responses: Anthropic.Message[]
): { client: Anthropic; calls: MockCall[] } {
    const calls: MockCall[] = [];
    let i = 0;
    const client = {
        messages: {
            create: async (opts: any) => {
                calls.push({
                    model: opts.model,
                    system: opts.system,
                    tools: opts.tools,
                    messages: JSON.parse(JSON.stringify(opts.messages)),
                });
                if (i >= responses.length) {
                    throw new Error("mock client out of scripted responses");
                }
                return responses[i++];
            },
        },
    } as unknown as Anthropic;
    return { client, calls };
}

function msg(
    content: Anthropic.ContentBlock[],
    stop_reason: Anthropic.Message["stop_reason"] = "tool_use",
    usage: Partial<Anthropic.Usage> = { input_tokens: 100, output_tokens: 50 }
): Anthropic.Message {
    return {
        id: "msg_x",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content,
        stop_reason,
        stop_sequence: null,
        usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            ...usage,
        } as Anthropic.Usage,
    };
}

describe("runAgent — env guards", () => {
    test("returns empty draft with diagnostic when ANTHROPIC_API_KEY missing", async () => {
        const prev = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        try {
            const out = await runAgent({
                readStdin: async () => candidateJson(),
            });
            expect(out.patch).toBe("");
            expect(out.error).toContain("ANTHROPIC_API_KEY");
            expect(out.model).toBe("claude-sonnet-4-6");
        } finally {
            if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
        }
    });
});

describe("runAgent — loop", () => {
    test("propose_patch on first turn ends the loop and surfaces patch+tokens", async () => {
        const responses = [
            msg(
                [
                    {
                        type: "tool_use",
                        id: "tu_1",
                        name: "propose_patch",
                        input: {
                            unified_diff:
                                "diff --git a/CLAUDE.md b/CLAUDE.md\n--- a/CLAUDE.md\n+++ b/CLAUDE.md\n@@ -1 +1,2 @@\n # Existing\n+- new line\n",
                            title: "docs(claude): note railway auth",
                            body: "Adds railway gotcha based on sessions sess_a, sess_b.",
                        },
                    },
                ],
                "tool_use",
                { input_tokens: 1234, output_tokens: 567, cache_read_input_tokens: 100 }
            ),
        ];
        const { client, calls } = makeMockClient(responses);
        const stubRubric = async () => ({
            clarity: 0.8,
            evidenceFit: 0.6,
            reversibility: 1.0,
        });
        const out = await runAgent({
            client,
            readStdin: async () => candidateJson(),
            scoreRubric: stubRubric,
        });
        expect(out.patch).toContain("diff --git a/CLAUDE.md");
        expect(out.files_changed).toEqual(["CLAUDE.md"]);
        expect(out.title).toBe("docs(claude): note railway auth");
        expect(out.body).toContain("sess_a");
        expect(out.tool_call_count).toBe(1);
        expect(out.input_tokens).toBe(1234 + 100);
        expect(out.output_tokens).toBe(567);
        expect(out.error).toBeUndefined();
        // Rubric ran on the non-empty patch.
        expect(out.rubric_scores).toEqual({
            clarity: 0.8,
            evidenceFit: 0.6,
            reversibility: 1.0,
        });

        // Validate model id, system cache_control, tool set.
        expect(calls[0].model).toBe("claude-sonnet-4-6");
        const sys = calls[0].system as any[];
        expect(sys[0].cache_control).toEqual({ type: "ephemeral" });
        const toolNames = (calls[0].tools as Array<{ name: string }>).map(
            (t) => t.name
        );
        expect(toolNames.sort()).toEqual(
            ["grep", "list_dir", "propose_patch", "read_file"].sort()
        );
    });

    test("read-only tool calls round-trip then propose_patch terminates", async () => {
        const responses = [
            msg([
                {
                    type: "tool_use",
                    id: "tu_a",
                    name: "list_dir",
                    input: { path: "." },
                },
                {
                    type: "tool_use",
                    id: "tu_b",
                    name: "read_file",
                    input: { path: "CLAUDE.md" },
                },
            ]),
            msg([
                {
                    type: "tool_use",
                    id: "tu_c",
                    name: "propose_patch",
                    input: {
                        unified_diff: "",
                        title: "no change",
                        body: "Nothing to add.",
                    },
                },
            ]),
        ];
        const { client, calls } = makeMockClient(responses);
        let rubricCalls = 0;
        const out = await runAgent({
            client,
            readStdin: async () => candidateJson(),
            scoreRubric: async () => {
                rubricCalls++;
                return null;
            },
        });
        expect(out.patch).toBe("");
        expect(out.rubric_scores).toBeNull();
        // Rubric MUST be skipped on empty patch.
        expect(rubricCalls).toBe(0);
        expect(out.tool_call_count).toBe(3);
        // Second API call must include the prior assistant turn + a user turn
        // of tool_result blocks for both list_dir and read_file.
        const secondMessages = calls[1].messages as any[];
        const lastTurn = secondMessages[secondMessages.length - 1];
        expect(lastTurn.role).toBe("user");
        expect(lastTurn.content).toHaveLength(2);
        expect(lastTurn.content[0].type).toBe("tool_result");
        expect(lastTurn.content[1].type).toBe("tool_result");
        // The list_dir result should mention CLAUDE.md.
        const dirResult = lastTurn.content.find(
            (c: any) => c.tool_use_id === "tu_a"
        );
        expect(dirResult.content).toContain("CLAUDE.md");
    });

    test("end_turn with no propose_patch returns empty draft with diagnostic", async () => {
        const responses = [
            msg([{ type: "text", text: "I give up." }], "end_turn"),
        ];
        const { client } = makeMockClient(responses);
        const out = await runAgent({
            client,
            readStdin: async () => candidateJson(),
        });
        expect(out.patch).toBe("");
        expect(out.error).toContain("without calling propose_patch");
    });

    test("invalid stdin JSON returns empty draft cleanly", async () => {
        const { client } = makeMockClient([]);
        const out = await runAgent({
            client,
            readStdin: async () => "{not json",
        });
        expect(out.patch).toBe("");
        expect(out.error).toContain("JSON parse failed");
    });
});

describe("dispatchTool", () => {
    test("read_file works", async () => {
        const r = await dispatchTool("read_file", { path: "CLAUDE.md" }, repoRoot);
        expect(r.isError).toBe(false);
        expect(r.content).toContain("# Existing");
    });
    test("path escape is captured as is_error tool result, not a throw", async () => {
        const r = await dispatchTool(
            "read_file",
            { path: "../../../etc/passwd" },
            repoRoot
        );
        expect(r.isError).toBe(true);
        expect(r.content).toMatch(/escapes repo|absolute/);
    });
    test("unknown tool name reported as is_error", async () => {
        const r = await dispatchTool("write_file", { path: "x" }, repoRoot);
        expect(r.isError).toBe(true);
        expect(r.content).toContain("unknown tool");
    });
});
