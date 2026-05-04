import { describe, expect, test } from "bun:test";
import { gateEvidenceDereferences } from "../gates/evidenceDereferences";
import type { Candidate } from "../types";

const cand = (sessionIds: string[]): Candidate => ({
    id: "c",
    kind: "claude_md",
    evidenceRefs: { sessionIds, patternIds: [], antiPatternIds: [], insightIds: [] },
});

describe("gateEvidenceDereferences", () => {
    test("passes when body cites a sess_ id present in evidenceRefs", () => {
        const r = gateEvidenceDereferences("Based on session sess_abc the railway CLI fails.", cand(["sess_abc"]));
        expect(r.pass).toBe(true);
        expect(r.gate).toBe("evidence_dereferences");
    });

    test("passes when body cites a UUID and evidenceRefs contains it", () => {
        const id = "f47ac10b-58cc-4372-a567-0e02b29c479e";
        const r = gateEvidenceDereferences(`Per session ${id} we saw repeated failures.`, cand([id]));
        expect(r.pass).toBe(true);
    });

    test("fails when body cites a sess_ id NOT in evidenceRefs", () => {
        const r = gateEvidenceDereferences("Based on session sess_other ...", cand(["sess_abc"]));
        expect(r.pass).toBe(false);
        expect(r.reason).toContain("none in candidate.evidenceRefs.sessionIds");
    });

    test("fails when body cites no session ids", () => {
        const r = gateEvidenceDereferences("Some prose with no IDs.", cand(["sess_abc"]));
        expect(r.pass).toBe(false);
        expect(r.reason).toContain("no session ids");
    });

    test("fails when body is empty", () => {
        const r = gateEvidenceDereferences("", cand(["sess_abc"]));
        expect(r.pass).toBe(false);
    });

    test("passes-with-note when candidate has no evidenceRefs but body cites valid id", () => {
        const r = gateEvidenceDereferences("From session sess_abc...", { id: "c", kind: "claude_md" });
        expect(r.pass).toBe(true);
        expect(r.reason).toContain("format-only");
    });
});
