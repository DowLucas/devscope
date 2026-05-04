// Local mirror of `VerificationResult` from packages/shared/src/github.ts.
// MUST stay in sync with the shared type — the sandbox image is built from a
// separate Docker context and intentionally has no access to @devscope/shared.

export type Gate =
    | "patch_applies"
    | "evidence_dereferences"
    | "kind_scope"
    | "tests"
    | "lint"
    | "conventions";

export interface VerificationResult {
    gate: Gate;
    pass: boolean;
    reason: string;
}

export interface ConventionProfile {
    titleFormat?: "conventional_commits" | "ticket_prefix" | "plain";
    branchFormat?: string;
    signOffRequired?: boolean;
    dcoRequired?: boolean;
}

export interface EvidenceRefs {
    sessionIds: string[];
    patternIds: string[];
    antiPatternIds: string[];
    insightIds: string[];
}

export interface Draft {
    patch: string;
    title?: string;
    body?: string;
    model?: string;
    files_changed?: string[];
}

export interface Candidate {
    id: string;
    kind: string;
    evidenceRefs?: EvidenceRefs;
    evidence_refs?: EvidenceRefs;
    conventionProfile?: ConventionProfile;
    convention_profile?: ConventionProfile;
}

/**
 * Parse a unified diff and return the set of file paths it touches.
 * Looks at `diff --git a/<x> b/<y>` headers. Uses the `b/` (post) path
 * since that is what the patch creates/modifies; for deletions a/ == b/.
 */
export function filesTouchedByPatch(patch: string): string[] {
    const files = new Set<string>();
    const re = /^diff --git a\/(\S+) b\/(\S+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(patch)) !== null) {
        files.add(m[2]);
    }
    return [...files];
}
