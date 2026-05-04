// Gate 3: evidence_dereferences.
//
// What we CAN check at the sandbox boundary:
//   - Every session-id-shaped token cited in the PR body parses as a
//     valid session id (UUID v4-ish OR `sess_<alnum>` test fixture form).
//   - The body references at least one of the candidate's
//     `evidenceRefs.sessionIds`.
//
// What we CANNOT check here (session transcripts live in the DB outside
// the sandbox): verbatim quote attribution. The richer dereference
// will need server-side post-processing or an explicit excerpt blob in
// the candidate JSON. Until then this gate is honest about its scope.

import type { Candidate, VerificationResult } from "../types";

// UUID (any version, lowercase or uppercase hex with dashes), or sess_<alnum>.
const SESSION_ID_RE =
    /\b(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|sess_[A-Za-z0-9_-]+)\b/g;

// Stricter validator for "does this token look like a valid session id?"
const SESSION_ID_VALID_RE =
    /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|sess_[A-Za-z0-9_-]+)$/;

export function gateEvidenceDereferences(
    body: string,
    candidate: Candidate
): VerificationResult {
    try {
        const refs = candidate.evidenceRefs ?? candidate.evidence_refs;
        const provided = new Set(refs?.sessionIds ?? []);

        if (!body || body.trim() === "") {
            return {
                gate: "evidence_dereferences",
                pass: false,
                reason: "body is empty; cannot dereference evidence",
            };
        }

        const cited = [...new Set(body.match(SESSION_ID_RE) ?? [])];
        if (cited.length === 0) {
            return {
                gate: "evidence_dereferences",
                pass: false,
                reason: "body cites no session ids",
            };
        }

        // Format check: every cited id must look valid. (Match regex
        // already guarantees this, but if a future edit loosens the
        // global regex this stays a defence.)
        const malformed = cited.filter((id) => !SESSION_ID_VALID_RE.test(id));
        if (malformed.length > 0) {
            return {
                gate: "evidence_dereferences",
                pass: false,
                reason: `malformed session id(s): ${malformed.slice(0, 3).join(", ")}`,
            };
        }

        if (provided.size === 0) {
            // No refs to cross-check; pass-with-note rather than fabricate.
            return {
                gate: "evidence_dereferences",
                pass: true,
                reason: `format-only: ${cited.length} id(s) cited, candidate has no evidenceRefs.sessionIds to cross-check`,
            };
        }

        const overlap = cited.filter((id) => provided.has(id));
        if (overlap.length === 0) {
            return {
                gate: "evidence_dereferences",
                pass: false,
                reason: `body cites ${cited.length} session id(s), none in candidate.evidenceRefs.sessionIds`,
            };
        }
        return {
            gate: "evidence_dereferences",
            pass: true,
            reason: `${overlap.length}/${cited.length} cited id(s) match candidate.evidenceRefs (format-level check; verbatim quote attribution not verifiable in sandbox)`,
        };
    } catch (err) {
        return {
            gate: "evidence_dereferences",
            pass: false,
            reason: `gate error: ${(err as Error).message}`,
        };
    }
}
