/**
 * Unit tests for the supplementary rubric scorer (Task 5.5 Part A).
 *
 * Mocks the Anthropic client so no API calls happen. Asserts:
 *   - happy path: well-formed JSON parses to RubricScores
 *   - parse failures (invalid JSON, missing field, junk text) → null
 *   - out-of-range numbers are clamped to [0, 1]
 *   - API error returns null (does not throw)
 *   - JSON wrapped in markdown fences is still extracted
 */
import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { parseRubricJson, scoreRubric } from "../rubric";

function mockClient(textOrError: string | Error): Anthropic {
    return {
        messages: {
            create: async () => {
                if (textOrError instanceof Error) throw textOrError;
                return {
                    id: "msg_x",
                    type: "message",
                    role: "assistant",
                    model: "claude-opus-4-7",
                    content: [{ type: "text", text: textOrError }],
                    stop_reason: "end_turn",
                    stop_sequence: null,
                    usage: {
                        input_tokens: 10,
                        output_tokens: 20,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: 0,
                    },
                } as unknown as Anthropic.Message;
            },
        },
    } as unknown as Anthropic;
}

const sampleInput = {
    patch: "diff --git a/CLAUDE.md b/CLAUDE.md\n+ note\n",
    title: "docs: note",
    body: "Adds a note. Sessions: sess_a.",
    evidenceBlock: "# Evidence\n- AP: foo",
};

describe("parseRubricJson", () => {
    test("parses a clean JSON object", () => {
        const out = parseRubricJson(
            `{"clarity": 0.8, "evidenceFit": 0.6, "reversibility": 1.0}`
        );
        expect(out).toEqual({ clarity: 0.8, evidenceFit: 0.6, reversibility: 1.0 });
    });

    test("clamps out-of-range numbers to [0, 1]", () => {
        const out = parseRubricJson(
            `{"clarity": 1.5, "evidenceFit": -0.3, "reversibility": 0.5}`
        );
        expect(out).toEqual({ clarity: 1, evidenceFit: 0, reversibility: 0.5 });
    });

    test("extracts JSON from markdown fences", () => {
        const raw = "Here are the scores:\n```json\n" +
            `{"clarity": 0.5, "evidenceFit": 0.5, "reversibility": 0.5}` +
            "\n```";
        const out = parseRubricJson(raw);
        expect(out).toEqual({ clarity: 0.5, evidenceFit: 0.5, reversibility: 0.5 });
    });

    test("returns null on invalid JSON", () => {
        expect(parseRubricJson("not json at all")).toBeNull();
    });

    test("returns null on missing field", () => {
        expect(
            parseRubricJson(`{"clarity": 0.5, "evidenceFit": 0.5}`)
        ).toBeNull();
    });

    test("coerces string numbers", () => {
        const out = parseRubricJson(
            `{"clarity": "0.7", "evidenceFit": "0.4", "reversibility": "0.9"}`
        );
        expect(out).toEqual({ clarity: 0.7, evidenceFit: 0.4, reversibility: 0.9 });
    });
});

describe("scoreRubric", () => {
    test("happy path: returns parsed RubricScores", async () => {
        const client = mockClient(
            `{"clarity": 0.7, "evidenceFit": 0.5, "reversibility": 1.0}`
        );
        const out = await scoreRubric(sampleInput, { client });
        expect(out).toEqual({ clarity: 0.7, evidenceFit: 0.5, reversibility: 1 });
    });

    test("API error returns null without throwing", async () => {
        // The rubric tries fallback on first error too — make BOTH calls fail.
        let calls = 0;
        const client = {
            messages: {
                create: async () => {
                    calls++;
                    throw new Error("rate limit");
                },
            },
        } as unknown as Anthropic;
        const out = await scoreRubric(sampleInput, { client });
        expect(out).toBeNull();
        // primary + fallback
        expect(calls).toBe(2);
    });

    test("parse failure returns null", async () => {
        const client = mockClient("I refuse to answer.");
        const out = await scoreRubric(sampleInput, { client });
        expect(out).toBeNull();
    });

    test("missing API key + no client returns null", async () => {
        const prev = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        try {
            const out = await scoreRubric(sampleInput);
            expect(out).toBeNull();
        } finally {
            if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
        }
    });
});
