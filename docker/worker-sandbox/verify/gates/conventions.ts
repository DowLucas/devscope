// Gate 6: conventions.
//
// Validates the draft's PR title and body against the repo installation's
// declared `conventionProfile`. Pure, no I/O.

import type { ConventionProfile, VerificationResult } from "../types";

const CONVENTIONAL_COMMITS_RE =
    /^(feat|fix|chore|docs|refactor|test|perf|style|build|ci|revert)(\([^)]+\))?!?: .+/;

// Default ticket prefix: e.g. `ABC-123: ` or `ABC-123 ` or `[ABC-123] `.
const TICKET_PREFIX_RE = /^(\[[A-Z]+-\d+\]|[A-Z]+-\d+)[:\s]/;

const SIGN_OFF_RE = /^Signed-off-by: .+ <.+@.+>$/m;

export function gateConventions(
    title: string,
    body: string,
    profile: ConventionProfile | undefined
): VerificationResult {
    try {
        if (!profile || Object.keys(profile).length === 0) {
            return {
                gate: "conventions",
                pass: true,
                reason: "no conventionProfile configured",
            };
        }

        const failures: string[] = [];

        const fmt = profile.titleFormat ?? "plain";
        if (fmt === "conventional_commits") {
            if (!title || !CONVENTIONAL_COMMITS_RE.test(title)) {
                failures.push(
                    `titleFormat=conventional_commits violated (got: ${JSON.stringify(title ?? "")})`
                );
            }
        } else if (fmt === "ticket_prefix") {
            if (!title || !TICKET_PREFIX_RE.test(title)) {
                failures.push(
                    `titleFormat=ticket_prefix violated (got: ${JSON.stringify(title ?? "")})`
                );
            }
        }
        // 'plain' or undefined → no title check.

        const needsSignOff =
            profile.signOffRequired === true || profile.dcoRequired === true;
        if (needsSignOff) {
            if (!body || !SIGN_OFF_RE.test(body)) {
                failures.push("signOff/DCO required but no Signed-off-by line in body");
            }
        }

        if (failures.length > 0) {
            return {
                gate: "conventions",
                pass: false,
                reason: failures.join("; "),
            };
        }
        return {
            gate: "conventions",
            pass: true,
            reason: `all configured conventions satisfied (titleFormat=${fmt}${needsSignOff ? ", signOff" : ""})`,
        };
    } catch (err) {
        return {
            gate: "conventions",
            pass: false,
            reason: `gate error: ${(err as Error).message}`,
        };
    }
}
